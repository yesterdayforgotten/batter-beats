// The voice engines the announcer can use. Everything engine-specific lives
// here, so adding or swapping engines doesn't touch the rest of the app.
//
// - ElevenLabs (ELEVENLABS_API_KEY, cloud): very natural voices and delivery
//   cues like [shouting] written into the text (Eleven v4). Announcements are
//   made once and stored, so the cost is tiny.
// - Kokoro (Kokoro-FastAPI, self-hosted at TTS_URL): light, free, runs on any
//   CPU; plainer voices with no emotion control. A fallback that needs no key.
//
// (Chatterbox and Murf were tried in October 2026 and removed: Chatterbox was
// very slow on the server's CPU; the owner preferred ElevenLabs to Murf. The
// ElevenLabs shared voice library was removed too: free plans can't use it.)

import fs from "node:fs";
import { config } from "./config.ts";
import { splitCues, type AnnouncerStyle, type AnnouncerVoice, type VoiceEngine } from "../shared/types.ts";

export interface Engine {
  id: VoiceEngine;
  label: string;
  defaultVoice: string;
  /**
   * How speed and pitch are changed: by the engine itself ("native", best),
   * afterwards with ffmpeg ("after", audibly processed), or not at all
   * ("none": the setting is hidden).
   */
  speed: "native" | "after" | "none";
  pitch: "native" | "after" | "none";
  /** Speaks text; returns audio data in whatever format the engine produces (ffmpeg reads it). */
  speak(text: string, voice: string, style: AnnouncerStyle): Promise<Buffer>;
  voices(): Promise<AnnouncerVoice[]>;
}

const UNREACHABLE = "The announcer voice engine isn't reachable.";

// Engines describe voices differently; these put gender, accent and age into
// the same few words so the Admin screen can filter by them.
const LOCALE_ACCENTS: Record<string, string> = {
  US: "American",
  UK: "British",
  GB: "British",
  AU: "Australian",
  IN: "Indian",
  SCOTT: "Scottish",
  CA: "Canadian",
  IE: "Irish",
  NZ: "New Zealand",
  ZA: "South African",
};
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export function normGender(g?: string): string | undefined {
  const v = g?.toLowerCase();
  return v === "male" || v === "m" ? "Male" : v === "female" || v === "f" ? "Female" : v ? titleCase(v) : undefined;
}
export function normAccent(a?: string): string | undefined {
  if (!a) return undefined;
  const locale = /^en-([A-Za-z]+)$/.exec(a)?.[1]?.toUpperCase();
  if (locale) return LOCALE_ACCENTS[locale] ?? locale;
  return titleCase(a.toLowerCase() === "us" ? "american" : a);
}
export function normAge(a?: string): string | undefined {
  const v = a?.toLowerCase().replace(/_/g, " ");
  if (!v) return undefined;
  if (/middle/.test(v)) return "Middle-aged";
  if (/young|teen|kid|child/.test(v)) return "Young";
  if (/old|senior|elder/.test(v)) return "Older";
  return undefined;
}

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
  const gender = m[2] === "m" ? "Male" : "Female";
  return { id, name, detail: `${ACCENTS[m[1]]} · ${gender.toLowerCase()}`, gender, accent: ACCENTS[m[1]] };
}

/**
 * Kokoro has no delivery cues and would read "[excited]" aloud, so cues in the
 * team's wording are taken out. Its pronunciation syntax, "[Name](/IPA/)", is kept.
 */
const withoutCues = (text: string) =>
  text
    .replace(/\[[^\]]*\](?!\()/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/^[\s,]+/, "")
    .trim();

const kokoro: Engine = {
  id: "kokoro",
  label: "Kokoro",
  defaultVoice: "am_michael",
  speed: "native",
  pitch: "after",
  async speak(text, voice, style) {
    const res = await call(
      "/v1/audio/speech",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "kokoro", input: withoutCues(text), voice, response_format: "mp3", speed: style.speed }),
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
    // Voices from the shared library need a paid plan (or $5 of credit) to use through the API.
    if (/paid_plan_required|library voices/i.test(err.message)) {
      throw new Error(
        "This voice is from the ElevenLabs library, which free accounts can't use from apps. Add $5 of credit or upgrade to Starter on elevenlabs.io, or pick one of ElevenLabs' own voices.",
      );
    }
    if (/quota_exceeded|quota|out of credits|insufficient/i.test(err.message)) {
      throw new Error("The ElevenLabs account is out of credits for this month.");
    }
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
 * ElevenLabs' "stability" for v3/v4: 0 Creative (widest emotional range),
 * 0.5 Natural, 1 Robust (steady). Our Range buttons pick one.
 */
const elevenStability = (excitement: number) => (excitement >= 1.4 ? 0 : excitement >= 0.75 ? 0.5 : 1);

const elevenlabs: Engine = {
  id: "elevenlabs",
  label: "ElevenLabs",
  // "Brian", one of ElevenLabs' own voices: deep, American, male.
  defaultVoice: "nPczCjzI2devNBz1zQrb",
  speed: "none",
  pitch: "none",
  async speak(text, voice, style) {
    // Each cue is its own tag: "[excited] [booming] Now batting…".
    const cue = splitCues(style.elevenTag)
      .map((c) => `[${c}]`)
      .join(" ");
    const res = await elevenCall(
      `/v1/text-to-speech/${encodeURIComponent(voice || this.defaultVoice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: cue ? `${cue} ${text}` : text,
          // v4: same price as v3, and in tests it responded to cues far more (v3 was dropped as an option).
          model_id: "eleven_v4",
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
      // Voices from ElevenLabs' shared library ("professional") need a paid plan to use from apps,
      // so they're left out; ElevenLabs' own voices work on the free plan.
      .filter((v) => v.category !== "professional")
      .map((v) => ({
        id: v.voice_id,
        name: v.name.split(" - ")[0],
        detail: elevenDetail(v.labels ?? {}) || (v.category === "premade" ? "ElevenLabs voice" : "Added to your account"),
        previewUrl: v.preview_url,
        gender: normGender(v.labels?.gender),
        accent: normAccent(v.labels?.accent),
        age: normAge(v.labels?.age),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};

/** The engines this server can use: ElevenLabs if its key is set, Kokoro if TTS_URL is set. */
export const engines: Engine[] = [
  ...(config.elevenLabsApiKey ? [elevenlabs] : []),
  ...(config.ttsUrl ? [kokoro] : []),
];
