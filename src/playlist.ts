// The between-innings playlist: each user's songs, played whole and shuffled,
// fading out when a batter is tapped.
//
// Whole songs are long, so they stream through an <audio> element instead of
// being decoded into memory like walkup clips. Its sound is routed through
// Web Audio so it can fade (iPhones ignore an <audio> element's volume).
//
// A phone can also keep the playlist's songs for offline use (cache "bb-songs").

import { api, isNetworkError } from "./api.ts";
import { context, FADE_CURVE } from "./audio/engine.ts";
import type { PlaylistSong } from "../shared/types.ts";

export const SONG_CACHE = "bb-songs";
const LIST_KEY = "bb.playlist";
const KEEP_KEY = "bb.playlist.keep";
const START_FADE_SEC = 0.3;
export const BATTER_FADE_SEC = 1.5;

// ── Stored list and offline copies ───────────────────────────────────────

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

export const savedPlaylist = (): PlaylistSong[] => read<PlaylistSong[]>(LIST_KEY, []);
export const keepsPlaylist = () => read<boolean>(KEEP_KEY, false);

/** The user's playlist from the server (remembered on the phone), or the remembered one without a connection. */
export async function loadPlaylist(): Promise<{ songs: PlaylistSong[]; offline: boolean }> {
  try {
    const r = await api<{ songs: PlaylistSong[] }>("/playlist", { timeoutMs: 6000 });
    write(LIST_KEY, r.songs);
    if (keepsPlaylist()) void downloadSongs(r.songs).catch(() => {});
    return { songs: r.songs, offline: false };
  } catch (err) {
    if (isNetworkError(err)) return { songs: savedPlaylist(), offline: true };
    throw err;
  }
}

export async function savePlaylist(songIds: number[]): Promise<PlaylistSong[]> {
  const r = await api<{ songs: PlaylistSong[] }>("/playlist", { method: "PUT", body: { songIds } });
  write(LIST_KEY, r.songs);
  if (keepsPlaylist()) void downloadSongs(r.songs).catch(() => {});
  else notify();
  return r.songs;
}

let downloading: { done: number; total: number } | null = null;
export const songDownloadProgress = () => downloading;

/** Which of the songs are on the phone. */
export async function storedSongIds(songs: PlaylistSong[]): Promise<Set<number>> {
  if (!hasCaches()) return new Set();
  const cache = await caches.open(SONG_CACHE);
  const present = await Promise.all(songs.map(async (s) => ((await cache.match(s.url)) ? s.id : null)));
  return new Set(present.filter((id): id is number => id !== null));
}

/** Downloads playlist songs the phone doesn't have, and removes ones no longer in the playlist. */
async function downloadSongs(songs: PlaylistSong[]) {
  if (!hasCaches()) throw new Error("This browser can't store songs. Use the https address.");
  if (downloading) return;
  const cache = await caches.open(SONG_CACHE);
  const wanted = new Set(songs.map((s) => new URL(s.url, location.href).href));
  for (const req of await cache.keys()) if (!wanted.has(req.url)) await cache.delete(req);
  downloading = { done: 0, total: songs.length };
  notify();
  try {
    for (const s of songs) {
      if (!(await cache.match(s.url))) {
        const res = await fetch(s.url, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`A song didn't download (${res.status}).`);
        await cache.put(s.url, res);
      }
      downloading.done++;
      notify();
    }
  } finally {
    downloading = null;
    notify();
  }
}

/** Keeps the playlist's songs on this phone (or stops, freeing the space). */
export async function setKeepPlaylist(keep: boolean) {
  write(KEEP_KEY, keep);
  notify();
  if (keep) {
    void navigator.storage?.persist?.().catch(() => false);
    await downloadSongs(savedPlaylist());
  } else if (hasCaches()) {
    await caches.delete(SONG_CACHE);
    notify();
  }
}

export async function clearPlaylistData() {
  try {
    localStorage.removeItem(LIST_KEY);
    localStorage.removeItem(KEEP_KEY);
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

type State = { status: "stopped" } | { status: "playing" | "fading"; song: PlaylistSong };

class InningsPlayer {
  private audio: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private queue: PlaylistSong[] = [];
  private all: PlaylistSong[] = [];
  private blobUrl: string | null = null;
  private failures = 0;
  private stopTimer: number | undefined;
  state: State = { status: "stopped" };

  private set(state: State) {
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
    this.gain.connect(c.destination);
    this.audio.addEventListener("ended", () => void this.next());
    this.audio.addEventListener("error", () => {
      if (this.state.status === "playing") void this.next(true);
    });
  }

  /** Starts the playlist in a fresh shuffle. */
  start(songs: PlaylistSong[]) {
    this.ensureAudio();
    window.clearTimeout(this.stopTimer);
    this.all = songs;
    this.queue = shuffled(songs);
    this.failures = 0;
    void this.next();
  }

  private async next(failed = false) {
    const audio = this.audio!;
    if (failed && ++this.failures >= this.all.length) return this.stop();
    if (this.queue.length === 0) this.queue = shuffled(this.all); // played them all: shuffle again
    const song = this.queue.shift();
    if (!song) return this.stop();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    // A copy kept on the phone plays without a connection.
    const kept = hasCaches() ? await (await caches.open(SONG_CACHE)).match(song.url) : undefined;
    if (kept) this.blobUrl = URL.createObjectURL(await kept.blob());
    else if (!navigator.onLine) return void this.next(true); // can't reach it; try the next one
    audio.src = this.blobUrl ?? song.url;
    const g = this.gain!.gain;
    const now = context().currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, now + START_FADE_SEC);
    this.set({ status: "playing", song });
    try {
      await audio.play();
      this.failures = 0;
    } catch {
      if (this.state.status === "playing") void this.next(true);
    }
  }

  /** Fades out and stops. */
  fadeOut(seconds = BATTER_FADE_SEC) {
    if (this.state.status !== "playing" || !this.audio || !this.gain) return;
    const now = context().currentTime;
    const g = this.gain.gain;
    const from = g.value;
    g.cancelScheduledValues(now);
    // The same curved fade as walkups, starting from wherever the volume is now.
    g.setValueCurveAtTime(FADE_CURVE.map((v) => v * from), now, seconds);
    this.set({ status: "fading", song: this.state.song });
    this.stopTimer = window.setTimeout(() => this.stop(), seconds * 1000 + 50);
  }

  stop() {
    window.clearTimeout(this.stopTimer);
    this.audio?.pause();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    this.set({ status: "stopped" });
  }
}

export const innings = new InningsPlayer();
