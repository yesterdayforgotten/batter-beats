// The voice engines the announcer can use. Each runs in its own container and
// is reached at TTS_URL; TTS_ENGINE says which kind it is. Everything engine-
// specific lives here, so swapping engines is a configuration change.
//
// - Kokoro (Kokoro-FastAPI): light, runs on any CPU, fixed voices, no emotion control.
// - Chatterbox (chatterbox-tts-api): an emotion ("exaggeration") dial and voices
//   cloned from a short recording; wants a graphics card, works slowly without one.

import fs from "node:fs";
import { config } from "./config.ts";
import type { AnnouncerStyle, AnnouncerVoice, VoiceEngine } from "../shared/types.ts";

export interface Engine {
  id: VoiceEngine;
  defaultVoice: string;
  /** True when the engine changes speed itself; otherwise it's done afterwards with ffmpeg. */
  nativeSpeed: boolean;
  /** Whether new voices can be added from a recording. */
  canAddVoices: boolean;
  /** Speaks text; returns audio data in whatever format the engine produces (ffmpeg reads it). */
  speak(text: string, voice: string, style: AnnouncerStyle): Promise<Buffer>;
  voices(): Promise<AnnouncerVoice[]>;
  addVoice(name: string, file: string, fileName: string): Promise<void>;
}

const UNREACHABLE = "The announcer voice engine isn't reachable.";

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.ttsUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new Error("The announcer voice engine took too long to answer.");
    throw new Error(UNREACHABLE);
  }
  if (!res.ok) throw new Error(`The announcer voice engine said no (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res;
}

// ── Kokoro ───────────────────────────────────────────────────────────────

// Kokoro voice ids look like "am_michael": language/accent, then female/male, then a name.
const ACCENTS: Record<string, string> = { a: "American", b: "British" };

function describeKokoro(id: string): AnnouncerVoice | null {
  const m = /^([a-z])([fm])_(.+)$/.exec(id);
  if (!m || !ACCENTS[m[1]]) return null; // only English voices: announcements are in English
  if (m[3].startsWith("v0")) return null; // older copies of voices also listed under their plain name
  const name = m[3].replace(/_inno$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { id, name, detail: `${ACCENTS[m[1]]} · ${m[2] === "m" ? "male" : "female"}` };
}

const kokoro: Engine = {
  id: "kokoro",
  defaultVoice: "am_michael",
  nativeSpeed: true,
  canAddVoices: false,
  async speak(text, voice, style) {
    const res = await call(
      "/v1/audio/speech",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "mp3", speed: style.speed }),
      },
      60_000,
    );
    return Buffer.from(await res.arrayBuffer());
  },
  async voices() {
    const data = (await (await call("/v1/audio/voices", {}, 10_000)).json()) as { voices?: (string | { id: string })[] };
    return (data.voices ?? [])
      .map((v) => describeKokoro(typeof v === "string" ? v : v.id))
      .filter((v): v is AnnouncerVoice => !!v)
      .sort((a, b) => a.detail.localeCompare(b.detail) || a.name.localeCompare(b.name));
  },
  async addVoice() {
    throw new Error("Kokoro can't learn new voices.");
  },
};

// ── Chatterbox ───────────────────────────────────────────────────────────

/** The engine's built-in voice (its default sample) is used when no voice is named. */
const CHATTERBOX_DEFAULT = "";

const chatterbox: Engine = {
  id: "chatterbox",
  defaultVoice: CHATTERBOX_DEFAULT,
  nativeSpeed: false,
  canAddVoices: true,
  async speak(text, voice, style) {
    const body: Record<string, unknown> = {
      input: text,
      exaggeration: style.excitement,
      cfg_weight: style.pace,
      temperature: 0.8,
    };
    if (voice) body.voice = voice;
    // Without a graphics card this can take a minute.
    const res = await call(
      "/v1/audio/speech",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      300_000,
    );
    return Buffer.from(await res.arrayBuffer());
  },
  async voices() {
    const data = (await (await call("/voices", {}, 10_000)).json()) as { voices?: { name?: string }[] };
    const library = (data.voices ?? [])
      .map((v) => v.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: name, name, detail: "From a recording" }));
    return [{ id: CHATTERBOX_DEFAULT, name: "Built-in voice", detail: "Chatterbox's own sample" }, ...library];
  },
  async addVoice(name, file, fileName) {
    const form = new FormData();
    form.set("voice_name", name);
    form.set("language", "en");
    form.set("voice_file", new Blob([await fs.promises.readFile(file)]), fileName);
    await call("/voices", { method: "POST", body: form }, 120_000);
  },
};

export const engine: Engine = config.ttsEngine === "chatterbox" ? chatterbox : kokoro;
