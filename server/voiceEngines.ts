// The voice engines the announcer can use. Everything engine-specific lives
// here, so adding or swapping engines doesn't touch the rest of the app.
//
// Self-hosted, in its own container at TTS_URL (TTS_ENGINE says which kind):
// - Kokoro (Kokoro-FastAPI): light, runs on any CPU, fixed voices, no emotion control.
// - Chatterbox (chatterbox-tts-api): an emotion ("exaggeration") dial and voices
//   cloned from a short recording; wants a graphics card, works slowly without one.
// Cloud, when their keys are set (announcements are made once and stored, so the cost is tiny):
// - Murf (MURF_API_KEY): professional voices with speaking styles (Promo, Newscast, …).
// - ElevenLabs (ELEVENLABS_API_KEY): very natural voices, a large shared voice
//   library, and delivery cues like [excited] written into the text (Eleven v3).

import fs from "node:fs";
import { config } from "./config.ts";
import type { AnnouncerStyle, AnnouncerVoice, LibraryVoice, VoiceEngine } from "../shared/types.ts";

export interface Engine {
  id: VoiceEngine;
  label: string;
  defaultVoice: string;
  /** True when the engine changes speed itself; otherwise it's done afterwards with ffmpeg. */
  nativeSpeed: boolean;
  /** Whether new voices can be added from a recording. */
  canAddVoices: boolean;
  /** Speaks text; returns audio data in whatever format the engine produces (ffmpeg reads it). */
  speak(text: string, voice: string, style: AnnouncerStyle): Promise<Buffer>;
  voices(): Promise<AnnouncerVoice[]>;
  addVoice(name: string, file: string, fileName: string): Promise<void>;
  /** Searching and adding voices from the engine's shared library (ElevenLabs). */
  searchLibrary?(query: string): Promise<LibraryVoice[]>;
  addFromLibrary?(ownerId: string, voiceId: string, name: string): Promise<void>;
}

const UNREACHABLE = "The announcer voice engine isn't reachable.";

async function call(path: string, init: RequestInit, timeoutMs: number, base = config.ttsUrl): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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
  label: "Kokoro",
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
  label: "Chatterbox",
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

// ── Murf (cloud) ─────────────────────────────────────────────────────────

interface MurfVoice {
  voiceId?: string;
  displayName?: string;
  gender?: string;
  locale?: string;
  description?: string;
  supportedLocales?: Record<string, { availableStyles?: string[]; detail?: string }>;
  availableStyles?: string[];
}

const murfCall = (path: string, init: RequestInit, timeoutMs: number) =>
  call(path, { ...init, headers: { ...(init.headers ?? {}), "api-key": config.murfApiKey } }, timeoutMs, config.murfUrl).catch(
    (err: Error) => {
      if (/\((401|403)\)/.test(err.message)) throw new Error("Murf refused the API key. Check MURF_API_KEY.");
      if (/\(402\)/.test(err.message)) throw new Error("The Murf account is out of credit.");
      throw new Error(err.message.replace("The announcer voice engine", "Murf"));
    },
  );

let murfVoiceCache: { at: number; voices: AnnouncerVoice[] } | null = null;

const murf: Engine = {
  id: "murf",
  label: "Murf",
  defaultVoice: "en-US-ken",
  nativeSpeed: true,
  canAddVoices: false,
  async speak(text, voice, style) {
    const body: Record<string, unknown> = {
      text,
      voiceId: voice || this.defaultVoice,
      // Murf's rate is −50…50 around normal; our speed 1.2 means 20% faster.
      rate: Math.max(-50, Math.min(50, Math.round((style.speed - 1) * 100))),
      format: "MP3",
      sampleRate: 44100,
      channelType: "MONO",
      // Return the audio itself, so Murf keeps no copy.
      encodeAsBase64: true,
      modelVersion: "GEN2",
    };
    // Styles differ per voice; only ask for one this voice has (after switching voices, the saved one may not exist).
    const styles = (await this.voices().catch(() => [])).find((v) => v.id === body.voiceId)?.styles ?? [];
    if (style.murfStyle && styles.includes(style.murfStyle)) body.style = style.murfStyle;
    const res = await murfCall(
      "/v1/speech/generate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      60_000,
    );
    const data = (await res.json()) as { encodedAudio?: string; audioFile?: string };
    if (data.encodedAudio) return Buffer.from(data.encodedAudio, "base64");
    if (data.audioFile) return Buffer.from(await (await fetch(data.audioFile)).arrayBuffer());
    throw new Error("Murf sent no audio.");
  },
  async voices() {
    // The list rarely changes; ask at most once an hour.
    if (murfVoiceCache && Date.now() - murfVoiceCache.at < 3_600_000) return murfVoiceCache.voices;
    const list = (await (await murfCall("/v1/speech/voices", {}, 15_000)).json()) as MurfVoice[];
    const voices = list
      .filter((v) => v.voiceId && (v.locale ?? "").startsWith("en"))
      .map((v) => ({
        id: v.voiceId!,
        name: (v.displayName ?? v.voiceId!).replace(/\s*\([MF]\)$/, ""),
        detail: [v.locale, v.gender?.toLowerCase(), v.description].filter(Boolean).join(" · "),
        styles: v.supportedLocales?.[v.locale ?? ""]?.availableStyles ?? v.availableStyles ?? [],
      }))
      .sort((a, b) => a.detail.localeCompare(b.detail) || a.name.localeCompare(b.name));
    murfVoiceCache = { at: Date.now(), voices };
    return voices;
  },
  async addVoice() {
    throw new Error("Voices can't be added to Murf from here.");
  },
};

// ── ElevenLabs (cloud) ───────────────────────────────────────────────────

const elevenCall = (path: string, init: RequestInit, timeoutMs: number) =>
  call(
    path,
    { ...init, headers: { ...(init.headers ?? {}), "xi-api-key": config.elevenLabsApiKey } },
    timeoutMs,
    config.elevenLabsUrl,
  ).catch((err: Error) => {
    const missing = /missing the permission (\w+)/.exec(err.message)?.[1];
    if (missing) {
      const what = missing.startsWith("voices") ? "Voices (read and write)" : missing;
      throw new Error(`The ElevenLabs key needs the "${what}" permission. Edit the key on elevenlabs.io and switch it on.`);
    }
    if (/\((401|403)\)/.test(err.message)) throw new Error("ElevenLabs refused the API key. Check ELEVENLABS_API_KEY.");
    if (/quota|credits/i.test(err.message)) throw new Error("The ElevenLabs account is out of credits for this month.");
    throw new Error(err.message.replace("The announcer voice engine", "ElevenLabs"));
  });

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

/** "male · american · middle aged · deep" from a voice's labels. */
const elevenDetail = (labels: Record<string, string | undefined>) =>
  [labels.gender, labels.accent, labels.age?.replace(/_/g, " "), labels.descriptive ?? labels.description, labels.use_case ?? labels["use case"]]
    .filter(Boolean)
    .join(" · ");

/**
 * Eleven v3's "stability" has three settings: 0 Creative (widest emotional
 * range), 0.5 Natural, 1 Robust (steady). Our Excite slider picks one.
 */
const elevenStability = (excitement: number) => (excitement >= 1.4 ? 0 : excitement >= 0.75 ? 0.5 : 1);

const elevenlabs: Engine = {
  id: "elevenlabs",
  label: "ElevenLabs",
  // "Brian", one of ElevenLabs' own voices: deep, American, male.
  defaultVoice: "nPczCjzI2devNBz1zQrb",
  nativeSpeed: false,
  canAddVoices: false,
  async speak(text, voice, style) {
    const cue = style.elevenTag.trim().replace(/^\[|\]$/g, "");
    const res = await elevenCall(
      `/v1/text-to-speech/${encodeURIComponent(voice || this.defaultVoice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cue ? `[${cue}] ${text}` : text,
          model_id: "eleven_v3",
          voice_settings: { stability: elevenStability(style.excitement) },
        }),
      },
      60_000,
    );
    return Buffer.from(await res.arrayBuffer());
  },
  async voices() {
    const data = (await (await elevenCall("/v2/voices?page_size=100", {}, 15_000)).json()) as { voices?: ElevenVoice[] };
    return (data.voices ?? [])
      .map((v) => ({
        id: v.voice_id,
        name: v.name.split(" - ")[0],
        detail: elevenDetail(v.labels ?? {}) || (v.category === "premade" ? "ElevenLabs voice" : "Added to your account"),
        previewUrl: v.preview_url,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async addVoice() {
    throw new Error("Add ElevenLabs voices from its library instead.");
  },
  async searchLibrary(query) {
    const params = new URLSearchParams({ page_size: "30", language: "en", sort: "cloned_by_count" });
    if (query.trim()) params.set("search", query.trim());
    const data = (await (await elevenCall(`/v1/shared-voices?${params}`, {}, 15_000)).json()) as {
      voices?: (ElevenVoice & { public_owner_id: string; gender?: string; age?: string; accent?: string; descriptive?: string; use_case?: string; cloned_by_count?: number })[];
    };
    return (data.voices ?? []).map((v) => ({
      id: v.voice_id,
      ownerId: v.public_owner_id,
      name: v.name.split(" - ")[0],
      detail: elevenDetail({ gender: v.gender, accent: v.accent, age: v.age, descriptive: v.descriptive, use_case: v.use_case }),
      previewUrl: v.preview_url,
      uses: v.cloned_by_count ?? 0,
    }));
  },
  async addFromLibrary(ownerId, voiceId, name) {
    await elevenCall(
      `/v1/voices/add/${encodeURIComponent(ownerId)}/${encodeURIComponent(voiceId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_name: name }) },
      30_000,
    );
  },
};

/** The engines this server can use: the self-hosted one (if TTS_URL is set) and the cloud ones whose keys are set. */
export const engines: Engine[] = [
  ...(config.ttsUrl ? [config.ttsEngine === "chatterbox" ? chatterbox : kokoro] : []),
  ...(config.murfApiKey ? [murf] : []),
  ...(config.elevenLabsApiKey ? [elevenlabs] : []),
];
