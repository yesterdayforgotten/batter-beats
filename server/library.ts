import fs from "node:fs";
import path from "node:path";
import { db } from "./db.ts";
import { scanMp3, cutClip } from "./mp3.ts";
import { applyFrameGain, computePeaks, measurePeak, readTags, removeQuietly } from "./audio.ts";
import { clipPath, dirs, peaksPath, songPath } from "./storage.ts";
import { wanted, type AnnouncerPlayerRow } from "./announcer.ts";
import { CLIP_LIMITS, type Clip, type Player, type Roster, type RosterSummary, type Song } from "../shared/types.ts";

// ── Songs ────────────────────────────────────────────────────────────────

interface SongRow {
  id: number;
  title: string;
  artist: string;
  original_name: string;
  duration_ms: number;
}

const toSong = (r: SongRow): Song => ({ id: r.id, title: r.title, artist: r.artist, durationMs: r.duration_ms });

export function listSongs(): Song[] {
  const rows = db.prepare("SELECT * FROM songs ORDER BY title COLLATE NOCASE, artist COLLATE NOCASE").all() as SongRow[];
  return rows.map(toSong);
}

export function getSong(id: number): Song | undefined {
  const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow | undefined;
  return row && toSong(row);
}

/** Checks an uploaded file, stores it in the library and builds its waveform. */
export async function addSong(tmpFile: string, originalName: string, userId: number): Promise<Song> {
  try {
    const buf = await fs.promises.readFile(tmpFile);
    const info = scanMp3(buf); // throws for anything that is not a usable MP3
    const tags = await readTags(tmpFile);
    const fallbackTitle = path.basename(originalName).replace(/\.mp3$/i, "").slice(0, 200) || "Untitled";
    const peaks = await computePeaks(tmpFile);
    const id = Number(
      db
        .prepare("INSERT INTO songs (title, artist, original_name, duration_ms, uploaded_by) VALUES (?, ?, ?, ?, ?)")
        .run(tags.title ?? fallbackTitle, tags.artist ?? "", originalName.slice(0, 300), Math.round(info.durationSec * 1000), userId)
        .lastInsertRowid,
    );
    await fs.promises.rename(tmpFile, songPath(id));
    await fs.promises.writeFile(peaksPath(id), JSON.stringify(peaks));
    return getSong(id)!;
  } finally {
    removeQuietly(tmpFile);
  }
}

// ── Rosters and players ──────────────────────────────────────────────────

interface PlayerRow extends AnnouncerPlayerRow {
  lineup_position: number;
  available: number;
  song_delay_ms: number;
  announce_ms: number;
}

interface ClipRow {
  id: number;
  player_id: number;
  song_id: number;
  start_ms: number;
  end_ms: number;
  fade_ms: number;
  volume: number;
  gain_db: number;
  bass_db: number;
  treble_db: number;
  clip_file: string | null;
  clip_offset_ms: number;
  clip_play_ms: number;
  clip_file_gain_db: number;
  clip_max_gain_db: number;
  clip_version: number;
}

function toClip(r: ClipRow, song: Song): Clip {
  return {
    id: r.id,
    song,
    startMs: r.start_ms,
    endMs: r.end_ms,
    fadeMs: r.fade_ms,
    volume: r.volume,
    gainDb: r.gain_db,
    bassDb: r.bass_db,
    trebleDb: r.treble_db,
    url: r.clip_file ? `/api/media/clips/${r.clip_file}` : null,
    offsetMs: r.clip_offset_ms,
    playMs: r.clip_play_ms,
    fileGainDb: r.clip_file_gain_db,
    maxGainDb: r.clip_max_gain_db,
    version: r.clip_version,
  };
}

function clipFor(playerId: number): Clip | null {
  const row = db
    .prepare("SELECT * FROM player_songs WHERE player_id = ? AND position = 0")
    .get(playerId) as ClipRow | undefined;
  if (!row) return null;
  return toClip(row, getSong(row.song_id)!);
}

function toPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    rosterId: r.roster_id,
    name: r.name,
    number: r.number,
    lineupPosition: r.lineup_position,
    available: !!r.available,
    clip: clipFor(r.id),
    pronunciation: r.pronunciation,
    announce: !!r.announce_enabled,
    songDelayMs: r.song_delay_ms,
    ...announcementOf(r),
  };
}

/** The player's announcement, if there is an up-to-date one. */
function announcementOf(r: PlayerRow): Pick<Player, "announcement" | "announcementStatus" | "announcementError"> {
  const w = wanted(r);
  if (!w) return { announcement: null, announcementStatus: "off", announcementError: null };
  if (r.announce_file && r.announce_key === w.key) {
    return {
      announcement: { url: `/api/media/announcements/${r.announce_file}`, durationMs: r.announce_ms },
      announcementStatus: "ready",
      announcementError: null,
    };
  }
  return r.announce_error
    ? { announcement: null, announcementStatus: "error", announcementError: r.announce_error }
    : { announcement: null, announcementStatus: "pending", announcementError: null };
}

export function touchRoster(rosterId: number) {
  db.prepare("UPDATE rosters SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(rosterId);
}

export function listRosters(): RosterSummary[] {
  return (
    db
      .prepare(
        `SELECT r.id, r.name, r.updated_at AS updatedAt, COUNT(p.id) AS playerCount
         FROM rosters r LEFT JOIN players p ON p.roster_id = r.id
         GROUP BY r.id ORDER BY r.name COLLATE NOCASE`,
      )
      .all() as RosterSummary[]
  );
}

export function getRoster(id: number): Roster | undefined {
  const r = db.prepare("SELECT id, name, updated_at, announce_enabled, announce_template FROM rosters WHERE id = ?").get(id) as
    | { id: number; name: string; updated_at: string; announce_enabled: number; announce_template: string }
    | undefined;
  if (!r) return undefined;
  const players = (
    db.prepare("SELECT * FROM players WHERE roster_id = ? ORDER BY lineup_position, id").all(id) as PlayerRow[]
  ).map(toPlayer);
  return {
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
    announce: !!r.announce_enabled,
    announceTemplate: r.announce_template,
    players,
  };
}

export function getPlayer(id: number): Player | undefined {
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow | undefined;
  return row && toPlayer(row);
}

// ── Clips ────────────────────────────────────────────────────────────────

export interface ClipSettings {
  startMs: number;
  endMs: number;
  fadeMs: number;
  volume: number;
  gainDb: number;
  bassDb: number;
  trebleDb: number;
}

/** Gives a player a song, with default clip settings, and cuts the clip. */
export async function setPlayerSong(playerId: number, songId: number): Promise<Clip> {
  const song = getSong(songId);
  if (!song) throw new UserError("Song not found.");
  const existing = db
    .prepare("SELECT * FROM player_songs WHERE player_id = ? AND position = 0")
    .get(playerId) as ClipRow | undefined;
  const endMs = Math.min(CLIP_LIMITS.defaultLengthMs, song.durationMs);
  const fadeMs = Math.min(existing?.fade_ms ?? CLIP_LIMITS.defaultFadeMs, Math.floor(endMs / 2));
  if (existing) {
    db.prepare(
      "UPDATE player_songs SET song_id = ?, start_ms = 0, end_ms = ?, fade_ms = ?, gain_db = 0 WHERE id = ?",
    ).run(songId, endMs, fadeMs, existing.id);
  } else {
    db.prepare(
      "INSERT INTO player_songs (player_id, song_id, position, start_ms, end_ms, fade_ms) VALUES (?, ?, 0, 0, ?, ?)",
    ).run(playerId, songId, endMs, fadeMs);
  }
  return recut(playerId, true);
}

/** Saves clip settings. Re-cuts the clip file only when the cut or the file gain changes. */
export async function updateClip(playerId: number, changes: Partial<ClipSettings>): Promise<Clip> {
  const row = db
    .prepare("SELECT * FROM player_songs WHERE player_id = ? AND position = 0")
    .get(playerId) as ClipRow | undefined;
  if (!row) throw new UserError("Choose a song for this player first.");
  const song = getSong(row.song_id)!;
  const s = validateClip(
    {
      startMs: changes.startMs ?? row.start_ms,
      endMs: changes.endMs ?? row.end_ms,
      fadeMs: changes.fadeMs ?? row.fade_ms,
      volume: changes.volume ?? row.volume,
      gainDb: changes.gainDb ?? row.gain_db,
      bassDb: changes.bassDb ?? row.bass_db,
      trebleDb: changes.trebleDb ?? row.treble_db,
    },
    song,
  );
  const cutChanged = s.startMs !== row.start_ms || s.endMs !== row.end_ms;
  // Same cut: the loudest safe gain is already known. (A new cut is measured
  // again and clamped in doRecut.)
  if (!cutChanged && row.clip_file) s.gainDb = Math.min(s.gainDb, row.clip_max_gain_db);
  db.prepare(
    `UPDATE player_songs SET start_ms = ?, end_ms = ?, fade_ms = ?, volume = ?, gain_db = ?, bass_db = ?,
     treble_db = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).run(s.startMs, s.endMs, s.fadeMs, s.volume, s.gainDb, s.bassDb, s.trebleDb, row.id);

  const fileGainChanged = fileGainFor(Math.min(s.gainDb, row.clip_max_gain_db)) !== row.clip_file_gain_db;
  if (cutChanged || fileGainChanged || !row.clip_file) return recut(playerId, cutChanged || !row.clip_file);
  touchRoster(rosterOf(playerId));
  return clipFor(playerId)!;
}

/** The part of the gain written into the file: the largest 1.5 dB multiple at or below it. */
export function fileGainFor(gainDb: number): number {
  return Math.floor(gainDb / CLIP_LIMITS.fileGainStepDb + 1e-9) * CLIP_LIMITS.fileGainStepDb;
}

function validateClip(s: ClipSettings, song: Song): ClipSettings {
  const num = (v: unknown, name: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new UserError(`Invalid ${name}.`);
    return n;
  };
  let startMs = Math.round(num(s.startMs, "start"));
  let endMs = Math.round(num(s.endMs, "end"));
  startMs = Math.max(0, Math.min(startMs, song.durationMs - CLIP_LIMITS.minLengthMs));
  endMs = Math.max(startMs + CLIP_LIMITS.minLengthMs, Math.min(endMs, song.durationMs, startMs + CLIP_LIMITS.maxLengthMs));
  const fadeMs = Math.round(Math.max(0, Math.min(num(s.fadeMs, "fade"), CLIP_LIMITS.maxFadeMs, endMs - startMs)));
  const volume = Math.max(0, Math.min(1, num(s.volume, "volume")));
  const step = CLIP_LIMITS.gainStepDb;
  const gainDb = Math.max(CLIP_LIMITS.minGainDb, Math.min(CLIP_LIMITS.maxGainDb, Math.round(num(s.gainDb, "gain") / step) * step));
  const tone = (v: unknown, name: string) =>
    Math.max(CLIP_LIMITS.toneMinDb, Math.min(CLIP_LIMITS.toneMaxDb, Math.round(num(v, name) * 2) / 2));
  return { startMs, endMs, fadeMs, volume, gainDb, bassDb: tone(s.bassDb, "bass"), trebleDb: tone(s.trebleDb, "treble") };
}

function rosterOf(playerId: number): number {
  return (db.prepare("SELECT roster_id FROM players WHERE id = ?").get(playerId) as { roster_id: number }).roster_id;
}

// One clip job at a time per player, so quick edits can't overlap.
const queues = new Map<number, Promise<unknown>>();

function recut(playerId: number, remeasure: boolean): Promise<Clip> {
  const prev = queues.get(playerId) ?? Promise.resolve();
  const job = prev.catch(() => {}).then(() => doRecut(playerId, remeasure));
  queues.set(playerId, job);
  job.finally(() => {
    if (queues.get(playerId) === job) queues.delete(playerId);
  }).catch(() => {});
  return job;
}

async function doRecut(playerId: number, remeasure: boolean): Promise<Clip> {
  const row = db
    .prepare("SELECT * FROM player_songs WHERE player_id = ? AND position = 0")
    .get(playerId) as ClipRow | undefined;
  if (!row) throw new UserError("This player has no song.");

  const source = await fs.promises.readFile(songPath(row.song_id));
  const info = scanMp3(source);
  const cut = cutClip(source, info, row.start_ms / 1000, row.end_ms / 1000);
  const version = row.clip_version + 1;
  const file = `${row.id}-${version}.mp3`;
  const tmp = path.join(dirs.tmp, file);
  await fs.promises.writeFile(tmp, cut.data);

  try {
    // Measure the loudest point of this clip before any gain, to know how far
    // it can be boosted without clipping.
    let maxGainDb = row.clip_max_gain_db;
    if (remeasure || !row.clip_file) {
      const peak = await measurePeak(tmp, cut.offsetSec, cut.playSec);
      const headroomDb = peak > 0 ? -20 * Math.log10(peak) : CLIP_LIMITS.maxGainDb;
      maxGainDb = Math.min(
        CLIP_LIMITS.maxGainDb,
        Math.floor(headroomDb / CLIP_LIMITS.gainStepDb + 1e-9) * CLIP_LIMITS.gainStepDb,
      );
    }
    const gainDb = Math.min(row.gain_db, maxGainDb);
    const fileGainDb = fileGainFor(gainDb);
    await applyFrameGain(tmp, Math.round(fileGainDb / CLIP_LIMITS.fileGainStepDb));
    await fs.promises.rename(tmp, clipPath(file));

    db.prepare(
      `UPDATE player_songs SET gain_db = ?, clip_file = ?, clip_offset_ms = ?, clip_play_ms = ?,
       clip_file_gain_db = ?, clip_max_gain_db = ?, clip_version = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
    ).run(gainDb, file, Math.round(cut.offsetSec * 1000), Math.round(cut.playSec * 1000), fileGainDb, maxGainDb, version, row.id);
    if (row.clip_file && row.clip_file !== file) removeQuietly(clipPath(row.clip_file));
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }
  touchRoster(rosterOf(playerId));
  return clipFor(playerId)!;
}

/** An error whose message is safe and useful to show the user. */
export class UserError extends Error {}
