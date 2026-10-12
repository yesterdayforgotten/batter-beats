// The announcer: "Now batting, number 12, Ava", spoken by the voice engine
// (Kokoro-FastAPI, in its own container) and stored as an MP3 per player, so
// phones play it like any clip and it works offline.
//
// An announcement is remade only when what it's made from changes: the
// wording, name, number, spelling or voice. That's captured in a short key
// stored with the file.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.ts";
import { config } from "./config.ts";
import { durationMs, normalizeVoice, removeQuietly } from "./audio.ts";
import { announcementPath, dirs } from "./storage.ts";
import { ANNOUNCER } from "../shared/types.ts";

/** A deep, clear American voice that suits a stadium announcer. Changeable by an admin. */
export const DEFAULT_VOICE = "am_michael";

/** Bumped when the way announcements are processed changes, so existing ones are remade. */
const PROCESSING = "loudness-2";

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

export const currentVoice = () => getSetting("announcer_voice") || DEFAULT_VOICE;

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
export function wanted(p: AnnouncerPlayerRow): { text: string; key: string; voice: string } | null {
  if (!config.ttsUrl || !p.announce_enabled) return null;
  const r = rosterRow(p.roster_id);
  if (!r?.announce_enabled) return null;
  const text = announcementText(r.announce_template, p.pronunciation.trim() || p.name, p.number);
  const voice = currentVoice();
  const key = crypto.createHash("sha1").update(`${PROCESSING}\n${voice}\n${text}`).digest("hex").slice(0, 12);
  return { text, key, voice };
}

/** Asks the voice engine to speak some text; returns MP3 data. */
export async function speak(text: string, voice: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(`${config.ttsUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "mp3", speed: 1 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("The announcer voice engine isn't reachable.");
  }
  if (!res.ok) throw new Error(`The announcer voice engine said no (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Speaks text and returns a finished, loudness-matched announcement file in tmp (the caller moves or deletes it). */
async function makeAnnouncementFile(text: string, voice: string): Promise<string> {
  const raw = path.join(dirs.tmp, `${crypto.randomUUID()}-raw.mp3`);
  const out = path.join(dirs.tmp, `${crypto.randomUUID()}.mp3`);
  try {
    await fs.promises.writeFile(raw, await speak(text, voice));
    await normalizeVoice(raw, out);
    return out;
  } finally {
    removeQuietly(raw);
  }
}

/** Speaks text in a voice and returns the finished MP3 data (for "listen" buttons and voice samples). */
export async function sample(text: string, voice: string): Promise<Buffer> {
  const file = await makeAnnouncementFile(text, voice);
  try {
    return await fs.promises.readFile(file);
  } finally {
    removeQuietly(file);
  }
}

const playerRow = (id: number) =>
  db.prepare("SELECT * FROM players WHERE id = ?").get(id) as AnnouncerPlayerRow | undefined;

/** Makes or remakes one player's announcement if it's out of date. */
async function update(playerId: number) {
  const p = playerRow(playerId);
  if (!p) return;
  const w = wanted(p);
  if (!w || (p.announce_key === w.key && p.announce_file && fs.existsSync(announcementPath(p.announce_file)))) return;
  try {
    const tmp = await makeAnnouncementFile(w.text, w.voice);
    const file = `${p.id}-${w.key}.mp3`;
    await fs.promises.rename(tmp, announcementPath(file));
    const ms = await durationMs(announcementPath(file));
    // The player may have changed again meanwhile; only keep this if it still matches.
    const now = playerRow(playerId);
    if (!now || wanted(now)?.key !== w.key) {
      if (file !== now?.announce_file) removeQuietly(announcementPath(file));
      return;
    }
    db.prepare(
      "UPDATE players SET announce_file = ?, announce_key = ?, announce_ms = ?, announce_error = NULL WHERE id = ?",
    ).run(file, w.key, ms, p.id);
    if (p.announce_file && p.announce_file !== file) removeQuietly(announcementPath(p.announce_file));
    db.prepare("UPDATE rosters SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(p.roster_id);
  } catch (err) {
    db.prepare("UPDATE players SET announce_error = ? WHERE id = ?").run((err as Error).message.slice(0, 300), p.id);
  }
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
      await update(id);
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
export async function listVoices(): Promise<string[]> {
  const res = await fetch(`${config.ttsUrl}/v1/audio/voices`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`The announcer voice engine said no (${res.status}).`);
  const data = (await res.json()) as { voices?: (string | { id: string })[] };
  return (data.voices ?? []).map((v) => (typeof v === "string" ? v : v.id)).filter(Boolean);
}

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
