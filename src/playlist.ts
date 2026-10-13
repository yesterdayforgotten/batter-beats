// Playlists and the jukebox: shared playlists of whole songs, played in game
// mode's Jukebox tab (or from the now-playing bar), fading out when a batter is
// tapped or Stop is pressed.
//
// Whole songs are long, so they stream through an <audio> element instead of
// being decoded into memory like walkup clips. Its sound is routed through
// Web Audio so it can fade and have its own volume (iPhones ignore an <audio>
// element's volume).
//
// A phone can keep any playlist's songs for offline use (cache "bb-songs").

import { api, isNetworkError } from "./api.ts";
import { context, FADE_CURVE, output } from "./audio/engine.ts";
import type { Playlist, PlaylistSong } from "../shared/types.ts";

export const SONG_CACHE = "bb-songs";
const LIST_KEY = "bb.playlists";
const KEEP_KEY = "bb.playlists.keep";
const SETTINGS_KEY = "bb.jukebox";
const teamKey = (rosterId: number | string) => `bb.jukebox.team.${rosterId}`;
const START_FADE_SEC = 0.3;
/** How quickly the jukebox gets out of the way when a batter is tapped. */
export const BATTER_FADE_SEC = 1.5;

// ── Small storage helpers ────────────────────────────────────────────────

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full.
  }
}

const hasCaches = () => typeof caches !== "undefined";

type Listener = () => void;
const listeners = new Set<Listener>();
export function onPlaylistChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

// ── Playlists (from the server, remembered on the phone) ─────────────────

export const savedPlaylists = (): Playlist[] => read<Playlist[]>(LIST_KEY, []);

function remember(playlists: Playlist[]) {
  write(LIST_KEY, playlists);
  void syncKeptSongs().catch(() => {});
  notify();
}

/** Every playlist from the server, or the ones remembered on the phone without a connection. */
export async function loadPlaylists(): Promise<{ playlists: Playlist[]; offline: boolean }> {
  try {
    const r = await api<{ playlists: Playlist[] }>("/playlists", { timeoutMs: 6000 });
    remember(r.playlists);
    return { playlists: r.playlists, offline: false };
  } catch (err) {
    if (isNetworkError(err)) return { playlists: savedPlaylists(), offline: true };
    throw err;
  }
}

/** Puts one changed playlist into the remembered list (or removes it). */
function rememberOne(playlist: Playlist | null, id: number) {
  const others = savedPlaylists().filter((p) => p.id !== id);
  remember(playlist ? [...others, playlist].sort((a, b) => a.name.localeCompare(b.name)) : others);
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const r = await api<{ playlist: Playlist }>("/playlists", { body: { name } });
  rememberOne(r.playlist, r.playlist.id);
  return r.playlist;
}

export async function renamePlaylist(id: number, name: string): Promise<Playlist> {
  const r = await api<{ playlist: Playlist }>(`/playlists/${id}`, { method: "PATCH", body: { name } });
  rememberOne(r.playlist, id);
  return r.playlist;
}

export async function setPlaylistSongs(id: number, songIds: number[]): Promise<Playlist> {
  const r = await api<{ playlist: Playlist }>(`/playlists/${id}/songs`, { method: "PUT", body: { songIds } });
  rememberOne(r.playlist, id);
  return r.playlist;
}

export async function deletePlaylist(id: number) {
  await api(`/playlists/${id}`, { method: "DELETE" });
  write(KEEP_KEY, keptPlaylistIds().filter((k) => k !== id));
  rememberOne(null, id);
}

// ── Which playlist each team's jukebox uses (per phone) ──────────────────

export const teamPlaylistId = (rosterId: number | string): number | null => read<number | null>(teamKey(rosterId), null);
export function setTeamPlaylist(rosterId: number | string, playlistId: number) {
  write(teamKey(rosterId), playlistId);
  notify();
}

// ── Jukebox settings (per phone) ─────────────────────────────────────────

export interface JukeboxSettings {
  shuffle: boolean;
  /** 0–1, against walkups at full volume. */
  volume: number;
  /** How long Stop takes to fade out. */
  fadeSec: number;
}

const DEFAULT_SETTINGS: JukeboxSettings = { shuffle: true, volume: 0.8, fadeSec: 1.5 };
export const jukeboxSettings = (): JukeboxSettings => ({ ...DEFAULT_SETTINGS, ...read<Partial<JukeboxSettings>>(SETTINGS_KEY, {}) });

export function setJukeboxSettings(changes: Partial<JukeboxSettings>) {
  write(SETTINGS_KEY, { ...jukeboxSettings(), ...changes });
  if (changes.volume !== undefined) jukebox.applyVolume();
  if (changes.shuffle !== undefined) jukebox.resetQueues(); // the next songs follow the new order
  notify();
}

// ── Keeping songs on the phone ───────────────────────────────────────────

export const keptPlaylistIds = (): number[] => read<number[]>(KEEP_KEY, []);
export const keepsPlaylist = (id: number) => keptPlaylistIds().includes(id);

let downloading: { playlistId: number; done: number; total: number } | null = null;
/** Progress while songs download for a playlist, or null. */
export const songDownloadProgress = (playlistId: number) => (downloading?.playlistId === playlistId ? downloading : null);

/** All songs being downloaded, over every kept playlist (each song counted once), for the sync bar. */
let songsOverall: { done: number; total: number } | null = null;
export const songDownloads = () => (songsOverall ? [{ key: "songs", ...songsOverall }] : []);

/** Which of the songs are on the phone. */
export async function storedSongIds(songs: PlaylistSong[]): Promise<Set<number>> {
  if (!hasCaches()) return new Set();
  const cache = await caches.open(SONG_CACHE);
  const present = await Promise.all(songs.map(async (s) => ((await cache.match(s.url)) ? s.id : null)));
  return new Set(present.filter((id): id is number => id !== null));
}

/** Songs that couldn't be downloaded in a sync (by URL). */
class SongsNotDownloaded extends Error {
  constructor(readonly urls: Set<string>) {
    super("Some songs didn't download.");
  }
}

let syncing: Promise<void> | null = null;
/** Set when the kept playlists change during a sync, so it goes round again. */
let syncAgain = false;

/**
 * Makes the phone hold exactly the songs of the playlists it keeps: downloads
 * what's missing, removes what no kept playlist has any more. A playlist kept
 * while songs are already downloading is picked up before it finishes.
 */
function syncKeptSongs(): Promise<void> {
  if (!hasCaches()) return Promise.resolve();
  syncAgain = true;
  if (syncing) return syncing;
  syncing = (async () => {
    const failed = new Set<string>();
    while (syncAgain) {
      syncAgain = false;
      await syncOnce(failed);
    }
    // Reported once everything else has been tried, so one bad song doesn't hold up the rest.
    if (failed.size > 0) throw new SongsNotDownloaded(failed);
  })().finally(() => {
    syncing = null;
    downloading = null;
    songsOverall = null;
    notify();
  });
  return syncing;
}

/** One pass: clears unwanted songs, then fetches missing ones, skipping (and noting) any that fail. */
async function syncOnce(failed: Set<string>) {
  const kept = savedPlaylists().filter((p) => keepsPlaylist(p.id));
  const cache = await caches.open(SONG_CACHE);
  const wanted = new Set(kept.flatMap((p) => p.songs.map((s) => new URL(s.url, location.href).href)));
  for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req);
  const allUrls = [...new Set(kept.flatMap((p) => p.songs.map((s) => s.url)))];
  const found = await Promise.all(allUrls.map((u) => cache.match(u)));
  const stored = new Set(allUrls.filter((_, i) => found[i]));
  const missing = allUrls.length - stored.size;
  // Nothing to fetch: no progress shown, so a routine refresh doesn't flash the sync bar.
  if (missing === 0) return;
  const done = songsOverall?.done ?? 0;
  songsOverall = { done, total: done + missing };
  for (const playlist of kept) {
    const have = playlist.songs.filter((s) => stored.has(s.url)).length;
    if (have === playlist.songs.length) continue;
    downloading = { playlistId: playlist.id, done: have, total: playlist.songs.length };
    notify();
    for (const s of playlist.songs) {
      // Switched off meanwhile: stop here; the next pass clears what it no longer needs.
      if (!keepsPlaylist(playlist.id)) break;
      if (stored.has(s.url)) continue;
      try {
        const res = await fetch(s.url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        await cache.put(s.url, res);
        stored.add(s.url);
        failed.delete(s.url);
        downloading.done++;
      } catch {
        failed.add(s.url);
      }
      songsOverall.done++;
      notify();
    }
    downloading = null;
    notify();
  }
}

/** Keeps a playlist's songs on this phone (or stops, freeing space no other kept playlist needs). */
export async function setKeepPlaylist(id: number, keep: boolean) {
  if (keep && !hasCaches()) throw new Error("This browser can't store songs. Use the https address.");
  write(KEEP_KEY, keep ? [...new Set([...keptPlaylistIds(), id])] : keptPlaylistIds().filter((k) => k !== id));
  notify();
  if (keep) void navigator.storage?.persist?.().catch(() => false);
  try {
    await syncKeptSongs();
  } catch (err) {
    if (!(err instanceof SongsNotDownloaded)) throw err;
    // Only this playlist's own missing songs are its problem (several may be syncing together).
    const playlist = savedPlaylists().find((p) => p.id === id);
    const missed = keep ? (playlist?.songs.filter((s) => err.urls.has(s.url)).length ?? 0) : 0;
    if (missed > 0) {
      throw new Error(`${missed === 1 ? "A song" : `${missed} songs`} didn't download. Turn it off and on to try again.`);
    }
  }
}

/** Everything playlist-related on the phone; cleared when signing out. */
export async function clearPlaylistData() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("bb.playlist") || k.startsWith("bb.jukebox")) localStorage.removeItem(k);
  } catch {
    // ignore
  }
  if (hasCaches()) await caches.delete(SONG_CACHE);
}

// ── Playing ──────────────────────────────────────────────────────────────

function shuffled<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type JukeboxState =
  | { status: "stopped" }
  | { status: "loading" | "playing" | "fading"; song: PlaylistSong; playlist: Playlist };

class Jukebox {
  private audio: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  /**
   * The songs still to come for each playlist, kept between stops so the jukebox
   * carries on where it left off; the first one is "up next".
   */
  private queues = new Map<number, PlaylistSong[]>();
  private playlist: Playlist | null = null;
  private blobUrl: string | null = null;
  private failures = 0;
  private stopTimer: number | undefined;
  private playId = 0;
  state: JukeboxState = { status: "stopped" };

  private set(state: JukeboxState) {
    this.state = state;
    notify();
  }

  /** Must be called from a tap: browsers only let sound start from one. */
  private ensureAudio() {
    if (this.audio) return;
    const c = context();
    this.audio = new Audio();
    this.audio.setAttribute("playsinline", "");
    this.audio.preload = "auto";
    this.gain = c.createGain();
    const source = c.createMediaElementSource(this.audio);
    source.connect(this.gain);
    this.gain.connect(output());
    this.audio.addEventListener("ended", () => {
      // Ending during a fade-out (a batter was tapped, or Stop) means stop, not "next song".
      if (this.state.status === "fading") this.stop();
      else void this.next();
    });
    this.audio.addEventListener("error", () => {
      if (this.state.status === "playing" || this.state.status === "loading") void this.next(true);
    });
  }

  /** A playlist's songs still to come (a fresh round, shuffled or in order, once they've all played). */
  private queueFor(playlist: Playlist): PlaylistSong[] {
    // Songs taken out of the playlist since are dropped; the latest copies of the rest are used.
    const byId = new Map(playlist.songs.map((s) => [s.id, s]));
    let queue = (this.queues.get(playlist.id) ?? []).flatMap((s) => byId.get(s.id) ?? []);
    if (queue.length === 0) {
      queue = jukeboxSettings().shuffle ? shuffled(playlist.songs) : playlist.songs.slice();
      // A new shuffled round doesn't open with the song that just played.
      const last = this.state.status === "stopped" ? null : this.state.song.id;
      if (queue.length > 1 && queue[0].id === last) queue.push(queue.shift()!);
    }
    this.queues.set(playlist.id, queue);
    return queue;
  }

  /** The song that plays next from this playlist (shown before pressing play). */
  upNext(playlist: Playlist): PlaylistSong | null {
    return playlist.songs.length ? this.queueFor(playlist)[0] : null;
  }

  /** Starts the next songs afresh (after switching between shuffle and in order). */
  resetQueues() {
    this.queues.clear();
  }

  /**
   * Plays a playlist: from the given song if one was tapped, otherwise the one
   * up next. Carries on through the playlist, shuffled or in order, and starts
   * over at the end.
   */
  play(playlist: Playlist, songId?: number) {
    if (playlist.songs.length === 0) return;
    this.ensureAudio();
    window.clearTimeout(this.stopTimer);
    this.playlist = playlist;
    this.failures = 0;
    if (songId !== undefined) {
      // A tapped song plays now; the rest follow it (shuffled, or in list order from there).
      const first = playlist.songs.find((s) => s.id === songId);
      if (jukeboxSettings().shuffle) {
        const rest = shuffled(playlist.songs.filter((s) => s.id !== songId));
        this.queues.set(playlist.id, first ? [first, ...rest] : rest);
      } else {
        const from = Math.max(0, playlist.songs.findIndex((s) => s.id === songId));
        this.queues.set(playlist.id, [...playlist.songs.slice(from), ...playlist.songs.slice(0, from)]);
      }
    }
    void this.next();
  }

  /**
   * Moves on: while playing, to the next song now; while stopped, just picks a
   * different song to play next (nothing starts).
   */
  skip(playlist?: Playlist) {
    if (this.state.status === "stopped") {
      if (!playlist || playlist.songs.length < 2) return;
      const queue = this.queueFor(playlist);
      queue.shift();
      this.queueFor(playlist); // a new round if that was the last one
      notify();
      return;
    }
    window.clearTimeout(this.stopTimer);
    void this.next();
  }

  private async next(failed = false) {
    const audio = this.audio!;
    const playlist = this.playlist;
    if (!playlist) return this.stop();
    if (failed && ++this.failures >= playlist.songs.length) return this.stop();
    const song = this.queueFor(playlist).shift();
    if (!song) return this.stop();
    const id = ++this.playId;
    this.set({ status: "loading", song, playlist });
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    // A copy kept on the phone plays without a connection.
    const kept = hasCaches() ? await (await caches.open(SONG_CACHE)).match(song.url) : undefined;
    if (id !== this.playId) return; // another song was chosen meanwhile
    const blob = kept ? await kept.blob() : null;
    if (id !== this.playId) return; // another song was chosen meanwhile (made no URL to leak)
    if (blob) this.blobUrl = URL.createObjectURL(blob);
    else if (!navigator.onLine) return void this.next(true); // can't reach it; try the next one
    audio.src = this.blobUrl ?? song.url;
    const g = this.gain!.gain;
    const now = context().currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(jukeboxSettings().volume, now + START_FADE_SEC);
    try {
      await audio.play();
      if (id !== this.playId) return;
      this.failures = 0;
      this.set({ status: "playing", song, playlist });
    } catch {
      if (id === this.playId && this.state.status !== "stopped") void this.next(true);
    }
  }

  /** Sets the volume of what's playing to the current setting. */
  applyVolume() {
    if (!this.gain || this.state.status !== "playing") return;
    const now = context().currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(jukeboxSettings().volume, now, 0.05);
  }

  /** Fades out and stops (Stop uses the fade setting; a batter's tap fades faster). */
  fadeOut(seconds = jukeboxSettings().fadeSec) {
    if ((this.state.status !== "playing" && this.state.status !== "loading") || !this.audio || !this.gain) return;
    if (this.state.status === "loading") return this.stop();
    const now = context().currentTime;
    const g = this.gain.gain;
    const from = g.value;
    g.cancelScheduledValues(now);
    // The same curved fade as walkups, starting from wherever the volume is now.
    g.setValueCurveAtTime(FADE_CURVE.map((v) => v * from), now, seconds);
    this.set({ status: "fading", song: this.state.song, playlist: this.state.playlist });
    this.stopTimer = window.setTimeout(() => this.stop(), seconds * 1000 + 50);
  }

  /** When the music last stopped (see justStopped). */
  private stoppedAt = -Infinity; // never stopped yet (performance.now() starts near 0 when the page opens)

  /**
   * True just after the music stopped: Play takes Stop's place in the bar, so a
   * tap meant to stop it shouldn't start it again.
   */
  justStopped(ms = 800) {
    return performance.now() - this.stoppedAt < ms;
  }

  stop() {
    if (this.state.status !== "stopped") this.stoppedAt = performance.now();
    window.clearTimeout(this.stopTimer);
    this.playId++;
    this.audio?.pause();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    this.set({ status: "stopped" });
  }
}

export const jukebox = new Jukebox();
