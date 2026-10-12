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
import { ANNOUNCER, DEFAULT_STYLE, STYLE_LIMITS, splitCues, type AnnouncerStyle, type Energy } from "../shared/types.ts";

/** Bumped when the way announcements are processed changes, so existing ones are remade. */
const PROCESSING = "convolution-4";

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

// Each engine has its own voices, so the chosen voice is stored per engine.
const voiceSetting = (e: Engine) => (e.id === "kokoro" ? "announcer_voice" : `announcer_voice_${e.id}`);
export const currentVoice = () => {
  const e = activeEngine();
  return e ? (getSetting(voiceSetting(e)) ?? e.defaultVoice) : "";
};
export const setVoice = (voice: string) => {
  const e = activeEngine();
  if (e) setSetting(voiceSetting(e), voice);
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
      typeof s.elevenTag === "string" ? splitCues(s.elevenTag).join(", ") : DEFAULT_STYLE.elevenTag,
  };
}

export function currentStyle(): AnnouncerStyle {
  try {
    return cleanStyle(JSON.parse(getSetting("announcer_style") ?? "{}"));
  } catch {
    return { ...DEFAULT_STYLE };
  }
}

export function setStyle(style: AnnouncerStyle) {
  setSetting("announcer_style", JSON.stringify(cleanStyle(style)));
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

function rosterRow(rosterId: number): AnnouncerRosterRow {
  return db.prepare("SELECT announce_enabled, announce_template FROM rosters WHERE id = ?").get(rosterId) as AnnouncerRosterRow;
}

/** What an announcement for this player would say, and the key identifying it; null when announcing is off. */
export function wanted(p: AnnouncerPlayerRow): { text: string; key: string; voice: string; style: AnnouncerStyle } | null {
  const engine = activeEngine();
  if (!engine || !p.announce_enabled) return null;
  const r = rosterRow(p.roster_id);
  if (!r?.announce_enabled) return null;
  const text = announcementText(r.announce_template, p.pronunciation.trim() || p.name, p.number);
  const voice = currentVoice();
  const style = currentStyle();
  const key = crypto
    .createHash("sha1")
    .update(`${PROCESSING}\n${engine.id}\n${voice}\n${JSON.stringify(style)}\n${text}`)
    .digest("hex")
    .slice(0, 12);
  return { text, key, voice, style };
}

/** Speaks text and returns a finished, loudness-matched announcement file in tmp (the caller moves or deletes it). */
async function makeAnnouncementFile(text: string, voice: string, style: AnnouncerStyle): Promise<string> {
  const engine = activeEngine();
  if (!engine) throw new Error("No announcer voice engine is set up.");
  const raw = path.join(dirs.tmp, `${crypto.randomUUID()}-raw`);
  const out = path.join(dirs.tmp, `${crypto.randomUUID()}.mp3`);
  try {
    await fs.promises.writeFile(raw, await engine.speak(withEnergy(text, style.energy), voice, style));
    // Only what the engine can't do itself is done here, afterwards.
    const tempo = engine.speed === "after" ? style.speed : 1;
    const pitch = engine.pitch === "after" ? style.pitch : 0;
    await normalizeVoice(raw, out, { pitch, tempo, reverb: style.reverb, reverbSize: style.reverbSize });
    return out;
  } finally {
    removeQuietly(raw);
  }
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
