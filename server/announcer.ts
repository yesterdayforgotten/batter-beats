// The announcer: "Now batting, number 12, Ava", spoken by the voice engine
// (ElevenLabs, or Kokoro self-hosted; see voiceEngines.ts) and stored
// as an MP3 per player, so phones play it like any clip and it works offline.
//
// An announcement is remade only when what it's made from changes: the
// wording, name, number, spelling, voice, engine or delivery. That's captured
// in a short key stored with the file.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.ts";
import { durationMs, normalizeVoice, removeQuietly } from "./audio.ts";
import { announcementPath, dirs } from "./storage.ts";
import { engines, type Engine } from "./voiceEngines.ts";
import {
  ANNOUNCER,
  DEFAULT_STYLE,
  formatCues,
  STYLE_LIMITS,
  splitCues,
  type AnnouncerStyle,
  type Energy,
} from "../shared/types.ts";

/** Bumped when the way announcements are processed changes, so existing ones are remade. */
const PROCESSING = "convolution-4";
/** Bumped when the echo effect changes; only announcements that use it are remade. */
const REVERB_VERSION = "stadium-echo-4";

export interface AnnouncerPlayerRow {
  id: number;
  roster_id: number;
  name: string;
  number: string;
  pronunciation: string;
  announce_enabled: number;
  announce_file: string | null;
  announce_key: string | null;
  announce_error: string | null;
}

interface AnnouncerRosterRow {
  announce_enabled: number;
  announce_template: string;
  announcer_voices: string | null;
  announcer_style: string | null;
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

/** The engine making announcements: the one an admin chose, else the first available. Null when none is set up. */
export function activeEngine(): Engine | null {
  const chosen = getSetting("announcer_engine");
  return engines.find((e) => e.id === chosen) ?? engines[0] ?? null;
}

export function setEngine(id: string): boolean {
  if (!engines.some((e) => e.id === id)) return false;
  setSetting("announcer_engine", id);
  return true;
}

// The app-wide voice and delivery, from before these were chosen per team, are now the
// defaults for a team that hasn't chosen its own. (Stored per engine, as each has its own voices.)
const voiceSetting = (e: Engine) => (e.id === "kokoro" ? "announcer_voice" : `announcer_voice_${e.id}`);
export const currentVoice = () => {
  const e = activeEngine();
  return e ? (getSetting(voiceSetting(e)) ?? e.defaultVoice) : "";
};

const ENERGIES: Energy[] = ["calm", "lively", "hyped"];
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2));

/** A style with every value present and within range. */
export function cleanStyle(input: unknown): AnnouncerStyle {
  const s = (typeof input === "object" && input ? input : {}) as Partial<AnnouncerStyle> & { echo?: boolean };
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    speed: round(clamp(num(s.speed, DEFAULT_STYLE.speed), STYLE_LIMITS.minSpeed, STYLE_LIMITS.maxSpeed), 0.05),
    energy: ENERGIES.includes(s.energy as Energy) ? (s.energy as Energy) : DEFAULT_STYLE.energy,
    pitch: round(clamp(num(s.pitch, DEFAULT_STYLE.pitch), 0, STYLE_LIMITS.maxPitch), 0.5),
    // Earlier versions had an on/off echo.
    reverb: round(clamp(num(s.reverb, s.echo ? 0.4 : DEFAULT_STYLE.reverb), 0, 1), 0.05),
    reverbSize: round(clamp(num(s.reverbSize, DEFAULT_STYLE.reverbSize), 0, 1), 0.05),
    excitement: round(
      clamp(num(s.excitement, DEFAULT_STYLE.excitement), STYLE_LIMITS.minExcitement, STYLE_LIMITS.maxExcitement),
      0.05,
    ),
    elevenTag:
      typeof s.elevenTag === "string" ? formatCues(splitCues(s.elevenTag)) : DEFAULT_STYLE.elevenTag,
  };
}

/** The default delivery, for teams that haven't chosen their own. */
export function currentStyle(): AnnouncerStyle {
  try {
    return cleanStyle(JSON.parse(getSetting("announcer_style") ?? "{}"));
  } catch {
    return { ...DEFAULT_STYLE };
  }
}

/**
 * Kokoro has no emotion setting, but it reads punctuation: exclamation marks
 * and short phrases make it sound livelier.
 *   calm:   "Now batting, number 12, Ava."
 *   lively: "Now batting, number 12, Ava!"
 *   hyped:  "Now batting! Number 12! Ava!"
 */
export function withEnergy(text: string, energy: Energy): string {
  const bare = text.replace(/[.!?\s]+$/, "");
  if (energy === "calm") return `${bare}.`;
  if (energy === "lively") return `${bare}!`;
  return `${bare.replace(/,\s*/g, "! ").replace(/!\s+([a-z])/g, (_, c: string) => `! ${c.toUpperCase()}`)}!`;
}

/** Fills in the team's wording. A player with no number skips the "number …" part. */
export function announcementText(template: string, name: string, number: string): string {
  let t = template || ANNOUNCER.defaultTemplate;
  if (!number.trim()) t = t.replace(/\bnumber\s*\{number\}/gi, "").replaceAll("{number}", "");
  return t
    .replaceAll("{number}", number.trim())
    .replaceAll("{name}", name.trim())
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1") // no space before punctuation
    .replace(/,(\s*,)+/g, ",") // commas left next to each other by a missing number
    .replace(/^[\s,]+|[\s,]+$/g, "") // or at either end
    .trim();
}

function rosterRow(rosterId: number): AnnouncerRosterRow | undefined {
  return db
    .prepare("SELECT announce_enabled, announce_template, announcer_voices, announcer_style FROM rosters WHERE id = ?")
    .get(rosterId) as AnnouncerRosterRow | undefined;
}

function parse<T>(json: string | null): T | null {
  try {
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

// Each team has its own announcer voice and delivery; a team that hasn't chosen
// uses the app-wide defaults (the settings from before voices were per team).

/** A team's voice for the engine in use. */
function voiceOf(r: AnnouncerRosterRow | undefined, engine: Engine): string {
  return parse<Record<string, string>>(r?.announcer_voices ?? null)?.[engine.id] ?? currentVoice();
}

/** A team's delivery settings. */
function styleOf(r: AnnouncerRosterRow | undefined): AnnouncerStyle {
  const saved = parse<unknown>(r?.announcer_style ?? null);
  return saved ? cleanStyle(saved) : currentStyle();
}

/** The voice and delivery a team's announcements use. */
export function teamAnnouncer(rosterId: number): { voice: string; style: AnnouncerStyle } {
  const r = rosterRow(rosterId);
  const engine = activeEngine();
  return { voice: engine ? voiceOf(r, engine) : "", style: styleOf(r) };
}

/** Saves a team's voice (for the engine in use) and/or delivery. */
export function setTeamAnnouncer(rosterId: number, changes: { voice?: string; style?: unknown }) {
  const r = rosterRow(rosterId);
  const engine = activeEngine();
  if (changes.voice !== undefined && engine) {
    const voices = parse<Record<string, string>>(r?.announcer_voices ?? null) ?? {};
    voices[engine.id] = changes.voice;
    db.prepare("UPDATE rosters SET announcer_voices = ? WHERE id = ?").run(JSON.stringify(voices), rosterId);
  }
  if (changes.style !== undefined) {
    db.prepare("UPDATE rosters SET announcer_style = ? WHERE id = ?").run(JSON.stringify(cleanStyle(changes.style)), rosterId);
  }
}

/** What an announcement for this player would say, and the key identifying it; null when announcing is off. */
export function wanted(p: AnnouncerPlayerRow): { text: string; key: string; voice: string; style: AnnouncerStyle } | null {
  const engine = activeEngine();
  if (!engine || !p.announce_enabled) return null;
  const r = rosterRow(p.roster_id);
  if (!r?.announce_enabled) return null;
  const text = announcementText(r.announce_template, p.pronunciation.trim() || p.name, p.number);
  const voice = voiceOf(r, engine);
  const style = styleOf(r);
  const key = crypto
    .createHash("sha1")
    // Reverb changes how it sounds, so a new reverb version remakes only announcements that use reverb.
    .update(`${PROCESSING}\n${engine.id}\n${voice}\n${JSON.stringify(style)}\n${text}` + (style.reverb > 0 ? `\n${REVERB_VERSION}` : ""))
    .digest("hex")
    .slice(0, 12);
  return { text, key, voice, style };
}

/** How many raw recordings to keep (about 50 KB each); the least recently used go first. */
const SPEECH_CACHE_FILES = 500;

/**
 * The voice engine's raw recording of some text, reused when nothing that
 * shapes the speech has changed: only the echo (and any speed or pitch we
 * apply afterwards) is redone. So trying echo settings, or changing them for
 * every announcement, costs no ElevenLabs credits. (The same settings also
 * give the same take, which makes comparing echo settings fair.)
 */
// Recordings on their way: a second request for the same one (Listen pressed again
// before the first finished) waits for it instead of paying for it twice.
const inFlight = new Map<string, Promise<string>>();

async function rawSpeech(engine: Engine, text: string, voice: string, style: AnnouncerStyle): Promise<string> {
  // Everything except what's done afterwards in ffmpeg.
  const { reverb: _reverb, reverbSize: _reverbSize, ...speech } = style;
  const spoken: Partial<AnnouncerStyle> = { ...speech };
  if (engine.speed !== "native") delete spoken.speed;
  if (engine.pitch !== "native") delete spoken.pitch;
  const key = crypto.createHash("sha1").update(JSON.stringify([engine.id, voice, text, spoken])).digest("hex");
  const file = path.join(dirs.speech, key);
  if (fs.existsSync(file)) {
    const now = new Date();
    await fs.promises.utimes(file, now, now).catch(() => {}); // recently used: keep it
    return file;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const tmp = path.join(dirs.tmp, `${crypto.randomUUID()}-raw`);
    await fs.promises.writeFile(tmp, await engine.speak(text, voice, style));
    await fs.promises.rename(tmp, file);
    void pruneSpeechCache();
    return file;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

async function pruneSpeechCache() {
  const names = await fs.promises.readdir(dirs.speech).catch(() => [] as string[]);
  if (names.length <= SPEECH_CACHE_FILES) return;
  const files = await Promise.all(
    names.map(async (n) => ({ n, t: (await fs.promises.stat(path.join(dirs.speech, n))).mtimeMs })),
  );
  files.sort((a, b) => a.t - b.t);
  for (const f of files.slice(0, files.length - SPEECH_CACHE_FILES)) removeQuietly(path.join(dirs.speech, f.n));
}

async function makeAnnouncementFile(text: string, voice: string, style: AnnouncerStyle): Promise<string> {
  const engine = activeEngine();
  if (!engine) throw new Error("No announcer voice engine is set up.");
  const raw = await rawSpeech(engine, withEnergy(text, style.energy), voice, style);
  const out = path.join(dirs.tmp, `${crypto.randomUUID()}.mp3`);
  // Only what the engine can't do itself is done here, afterwards.
  const tempo = engine.speed === "after" ? style.speed : 1;
  const pitch = engine.pitch === "after" ? style.pitch : 0;
  await normalizeVoice(raw, out, { pitch, tempo, reverb: style.reverb, reverbSize: style.reverbSize });
  return out;
}

/** Speaks text in a voice and returns the finished MP3 data (for "listen" buttons and voice samples). */
export async function sample(text: string, voice: string, style: AnnouncerStyle = currentStyle()): Promise<Buffer> {
  const file = await makeAnnouncementFile(text, voice, style);
  try {
    return await fs.promises.readFile(file);
  } finally {
    removeQuietly(file);
  }
}

const playerRow = (id: number) =>
  db.prepare("SELECT * FROM players WHERE id = ?").get(id) as AnnouncerPlayerRow | undefined;

/**
 * Makes or remakes one player's announcement if it's out of date. Returns
 * "changed" if the player or settings changed while it was being made (the
 * result was thrown away and it should be made again).
 */
async function update(playerId: number): Promise<"done" | "changed"> {
  const p = playerRow(playerId);
  if (!p) return "done";
  const w = wanted(p);
  if (!w || (p.announce_key === w.key && p.announce_file && fs.existsSync(announcementPath(p.announce_file)))) {
    return "done";
  }
  try {
    const tmp = await makeAnnouncementFile(w.text, w.voice, w.style);
    const file = `${p.id}-${w.key}.mp3`;
    await fs.promises.rename(tmp, announcementPath(file));
    const ms = await durationMs(announcementPath(file));
    // The player may have changed again meanwhile; only keep this if it still matches.
    const now = playerRow(playerId);
    if (!now || wanted(now)?.key !== w.key) {
      if (file !== now?.announce_file) removeQuietly(announcementPath(file));
      return now ? "changed" : "done";
    }
    db.prepare(
      "UPDATE players SET announce_file = ?, announce_key = ?, announce_ms = ?, announce_error = NULL WHERE id = ?",
    ).run(file, w.key, ms, p.id);
    if (p.announce_file && p.announce_file !== file) removeQuietly(announcementPath(p.announce_file));
    db.prepare("UPDATE rosters SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(p.roster_id);
  } catch (err) {
    db.prepare("UPDATE players SET announce_error = ? WHERE id = ?").run((err as Error).message.slice(0, 300), p.id);
  }
  return "done";
}

// Announcements are made one at a time, in the background.
const queued = new Set<number>();
const waiters = new Map<number, (() => void)[]>();
let running = false;

async function work() {
  if (running) return;
  running = true;
  try {
    for (const id of queued) {
      queued.delete(id);
      // If something changed while it was being made, make it again (a few times at most), so
      // anyone waiting (the Listen button) gets the up-to-date announcement.
      for (let tries = 0; tries < 3 && (await update(id)) === "changed"; tries++);
      for (const done of waiters.get(id) ?? []) done();
      waiters.delete(id);
    }
  } finally {
    running = false;
  }
}

/** Queues players' announcements to be brought up to date. Resolves when they have been. */
export function refreshAnnouncements(playerIds: number[]): Promise<void> {
  if (playerIds.length === 0) return Promise.resolve();
  const done = Promise.all(
    playerIds.map(
      (id) =>
        new Promise<void>((resolve) => {
          queued.add(id);
          waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
        }),
    ),
  ).then(() => {});
  void work();
  return done;
}

export function refreshRosterAnnouncements(rosterId: number) {
  const ids = db.prepare("SELECT id FROM players WHERE roster_id = ?").all(rosterId) as { id: number }[];
  return refreshAnnouncements(ids.map((r) => r.id));
}

export function refreshAllAnnouncements() {
  const ids = db.prepare("SELECT id FROM players").all() as { id: number }[];
  return refreshAnnouncements(ids.map((r) => r.id));
}

/** The voices the engine offers. */
export const listVoices = () => activeEngine()?.voices() ?? Promise.resolve([]);

/**
 * Tries again for players whose announcement failed, for example because the
 * voice engine was still starting when this server did (they start together).
 */
export function retryFailedAnnouncements() {
  const failed = db.prepare("SELECT * FROM players WHERE announce_error IS NOT NULL").all() as AnnouncerPlayerRow[];
  const ids = failed.filter((p) => {
    const w = wanted(p);
    return w && w.key !== p.announce_key;
  });
  return refreshAnnouncements(ids.map((p) => p.id));
}

const RETRY_EVERY_MS = 30_000;

/** At server start: bring every announcement up to date, then keep retrying any that fail. */
export function startAnnouncer() {
  void refreshAllAnnouncements();
  setInterval(() => void retryFailedAnnouncements(), RETRY_EVERY_MS).unref();
}
