import fs from "node:fs";
import { spawn } from "node:child_process";

/** Runs a command and returns its standard output as a Buffer. */
function run(cmd: string, args: string[]): Promise<Buffer> {
  return runFull(cmd, args).then((r) => r.out);
}

/** Runs a command and returns both what it printed and its messages (ffmpeg reports measurements there). */
function runFull(cmd: string, args: string[]): Promise<{ out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ out: Buffer.concat(out), err });
      else reject(new Error(`${cmd} failed (${code}): ${err.slice(-500)}`));
    });
  });
}

export async function readTags(file: string): Promise<{ title?: string; artist?: string }> {
  try {
    const out = await run("ffprobe", ["-v", "error", "-show_entries", "format_tags=title,artist", "-of", "json", file]);
    const tags = JSON.parse(out.toString()).format?.tags ?? {};
    const pick = (k: string) => {
      const v = tags[k] ?? tags[k.toUpperCase()];
      return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
    };
    return { title: pick("title"), artist: pick("artist") };
  } catch {
    return {};
  }
}

/** Points per second in a song's waveform overview. */
export const PEAKS_PER_SECOND = 20;

/**
 * Builds the waveform overview for a song: the loudest level in each
 * 1/20th of a second, scaled 0–255.
 */
export async function computePeaks(file: string): Promise<number[]> {
  const rate = 8000;
  const pcm = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const bucket = rate / PEAKS_PER_SECOND;
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += bucket) {
    let max = 0;
    const end = Math.min(samples.length, i + bucket);
    for (let j = i; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks.push(Math.round((max / 32768) * 255));
  }
  return peaks;
}

/**
 * Loudest sample (1.0 = full scale) in the part of a clip that is actually
 * played, i.e. after the lead-in frames.
 */
export async function measurePeak(file: string, offsetSec: number, playSec: number): Promise<number> {
  const pcm = await run("ffmpeg", [
    "-v", "error",
    "-i", file,
    "-ss", offsetSec.toFixed(4),
    "-t", playSec.toFixed(4),
    "-f", "f32le",
    "-",
  ]);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > max) max = v;
  }
  return max;
}

/**
 * Changes the gain stored in every frame of an MP3 file by `steps` × 1.5 dB,
 * the same lossless method MP3Gain uses. The audio data is not re-encoded.
 */
export async function applyFrameGain(file: string, steps: number): Promise<void> {
  if (steps === 0) return;
  await run("mp3gain", ["-g", String(steps), "-c", "-q", "-s", "s", file]);
}

/** Length of an audio file in milliseconds. */
export async function durationMs(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Math.round(Number(out.toString().trim()) * 1000);
}

/** Loudness the announcer's voice is set to (LUFS): about as loud as a typical walkup song. */
export const VOICE_LUFS = -13;

/** The settings that change how an announcement sounds after the voice engine has spoken it. */
export interface VoiceEffects {
  /** Semitones up, keeping the voice's character (formants) natural. */
  pitch: number;
  /** Speed change for engines that can't do it themselves (1 = none). */
  tempo: number;
  /** Stadium echo: how loud (0 = none … 1 = strong) and how far (0 = small field … 1 = big stadium). */
  reverb: number;
  reverbSize: number;
}

const SAMPLE_RATE = 44100;

/**
 * A stadium echo, not a reverb. A ballpark is open air: there's almost no
 * reverb (that's the sound of walls and a roof, which made earlier versions
 * sound like a warehouse). What you hear is the PA voice, then a few distinct
 * echoes coming back off the far stands a fraction of a second later, each
 * quieter and duller with distance. So: three delayed, filtered copies.
 *
 * - amount (0–1, shown as Echo): the first echo's level, from about 34 dB
 *   under the voice (5%) to 10 dB under (100%); each later one 6 dB quieter.
 * - size (0–1, shown as Distance): first echo after 90 ms (small field) to
 *   250 ms (big stadium); the others at about 2× and 3× that.
 */
function stadiumEcho(amount: number, size: number): { pad: number; graph: (input: string, output: string) => string } {
  const first = 90 + 160 * size;
  const delays = [first, first * 1.9, first * 2.9].map(Math.round);
  const firstDb = -34 + 24 * amount;
  const levels = delays.map((_, i) => 10 ** ((firstDb - 6 * i) / 20));
  // Farther echoes lose more of their highs.
  const cutoffs = delays.map((_, i) => Math.round(3200 - 700 * i - 800 * size));
  return {
    pad: delays[delays.length - 1] / 1000 + 0.3,
    graph: (input, output) =>
      `${input}asplit=4[dry][e0][e1][e2];` +
      delays
        .map(
          (ms, i) =>
            `[e${i}]adelay=${ms},highpass=f=250,lowpass=f=${cutoffs[i]},volume=${levels[i].toFixed(5)}[d${i}];`,
        )
        .join("") +
      `[dry][d0][d1][d2]amix=inputs=4:normalize=0${output}`,
  };
}

/** The ffmpeg graph for an announcement's effects, from the voice ([0:a]) to a stream labelled [fx]. */
function effectsGraph(o: VoiceEffects): string {
  const steps = [`aresample=${SAMPLE_RATE}`, "aformat=channel_layouts=mono"];
  if (o.pitch > 0 || o.tempo !== 1) {
    steps.push(`rubberband=pitch=${(2 ** (o.pitch / 12)).toFixed(4)}:tempo=${o.tempo.toFixed(3)}:formant=preserved`);
  }
  if (o.reverb <= 0) return `[0:a]${steps.join(",")}[fx]`;
  const echo = stadiumEcho(o.reverb, o.reverbSize);
  return (
    echo.graph(`[0:a]${steps.join(",")},apad=pad_dur=${echo.pad.toFixed(2)},`, "[mixed]") +
    // End the file once the last echo has died away: the song stays quiet until the announcement
    // ends, so silence at the end would hold it down. (Reversed, so only the end is trimmed.)
    ";[mixed]areverse,silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.05,areverse[fx]"
  );
}

/** Integrated loudness, in LUFS (EBU R128), of the voice with its effects. */
async function loudness(file: string, graph: string): Promise<number> {
  const { err } = await runFull("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", file,
    "-filter_complex", `${graph};[fx]ebur128[out]`,
    "-map", "[out]", "-f", "null", "-",
  ]);
  // The summary at the end (older ffmpeg also logs every frame before it).
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(err.slice(err.lastIndexOf("Summary:")));
  const value = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(value)) throw new Error("Couldn't measure the announcement's loudness.");
  return value;
}

/**
 * Turns the voice engine's output into an announcement MP3 at a steady
 * loudness, so every player's announcement is equally loud. (Speech is
 * re-encoded; only songs have to stay untouched.)
 *
 * ffmpeg's loudnorm filter misjudges clips under about 3 seconds, which most
 * announcements are, so the loudness is measured and the gain set directly,
 * with a limiter catching the loudest syllables.
 */
export async function normalizeVoice(input: string, output: string, effects: VoiceEffects): Promise<void> {
  const fx = effectsGraph(effects);
  // Effects come first, so the loudness is measured as heard.
  const gainDb = Math.max(-20, Math.min(30, VOICE_LUFS - (await loudness(input, fx))));
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-i", input,
    "-filter_complex",
    `${fx};[fx]volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.84:attack=2:release=50:level=false[out]`,
    "-map", "[out]",
    "-ar", `${SAMPLE_RATE}`, "-ac", "1",
    "-c:a", "libmp3lame", "-b:a", "128k",
    output,
  ]);
}

export async function ensureTools(): Promise<void> {
  for (const [cmd, args] of [["ffmpeg", ["-version"]], ["ffprobe", ["-version"]], ["mp3gain", ["-v"]]] as const) {
    try {
      await run(cmd, [...args]);
    } catch {
      console.warn(`Warning: ${cmd} is not available. Song upload and clips will not work.`);
    }
  }
}

export function removeQuietly(file: string | null | undefined) {
  if (file) fs.rm(file, { force: true }, () => {});
}
