import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { dirs } from "./storage.ts";

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
  /** Reverb: how much (0 = none … 1 = lots) and how big a space (0 = small room … 1 = ballpark). */
  reverb: number;
  reverbSize: number;
}

const SAMPLE_RATE = 44100;

/**
 * Makes (once, then reuses) an "impulse response": how a space answers a
 * single clap. Convolving the voice with it gives a smooth, natural reverb;
 * the earlier approach (many short echoes) rang at a pitch and sounded tinny.
 * It's generated, not recorded, so there's nothing to license: a short
 * pre-delay (distance to the walls), then pink noise fading away
 * exponentially over the space's reverb time, darker the bigger the space
 * (air and far walls soak up the highs).
 *
 * It is calibrated so the reverb comes out exactly as loud as the
 * voice before mixing, and the Reverb amount alone sets how much is heard.
 * (Version 3: version 1 used afir's automatic gain and version 2 unit energy; both made the reverb
 * 10-15 dB louder than the voice, so even 5% was too much.)
 */
async function impulseResponse(size: number): Promise<string> {
  const s = Math.round(Math.max(0, Math.min(1, size)) * 20) / 20; // 21 sizes, each made once
  const file = path.join(dirs.tmp, `reverb-ir3-${s.toFixed(2)}.wav`);
  if (fs.existsSync(file)) return file;
  const rt60 = 0.8 + 2.7 * s; // seconds to fade by 60 dB: 0.8 s room … 3.5 s ballpark
  const preDelayMs = Math.round(12 + 60 * s);
  const length = rt60 + 0.2;
  const tmp = `${file}.${process.pid}.tmp.wav`;
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi",
    "-i", `anoisesrc=d=${length.toFixed(2)}:c=pink:r=${SAMPLE_RATE}:a=0.5:seed=7`,
    "-af", [
      `aeval='val(0)*exp(-6.9078*t/${rt60.toFixed(2)})':c=same`,
      "highpass=f=180",
      `lowpass=f=${Math.round(6500 - 3500 * s)}`,
      `lowpass=f=${Math.round(9000 - 4000 * s)}`,
      `adelay=${preDelayMs}`,
    ].join(","),
    "-ac", "1",
    "-c:a", "pcm_f32le",
    tmp,
  ]);
  // Calibrate by loudness, as heard: put a speech-like test signal (pink noise, rolled off above
  // 4 kHz like a voice) through the reverb and scale the response so what comes out is exactly
  // as loud as what went in. Then the Reverb amount alone sets how far under the voice it sits.
  const testSignal = `anoisesrc=d=4:c=pink:r=${SAMPLE_RATE}:a=0.3:seed=3,lowpass=f=4000`;
  const measure = async (graph: string, extraInputs: string[]) => {
    const { err } = await runFull("ffmpeg", [
      "-hide_banner", "-nostats",
      "-f", "lavfi", "-i", testSignal, ...extraInputs,
      "-filter_complex", `${graph}ebur128[out]`,
      "-map", "[out]", "-f", "null", "-",
    ]);
    const m = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(err.slice(err.lastIndexOf("Summary:")));
    const value = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(value)) throw new Error("Couldn't calibrate the reverb.");
    return value;
  };
  const dry = await measure("[0:a]", []);
  const wet = await measure("[0:a][1:a]afir=gtype=none,", ["-i", tmp]);
  await run("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-af", `volume=${(dry - wet).toFixed(3)}dB`, "-c:a", "pcm_f32le", file]);
  await fs.promises.rm(tmp, { force: true });
  return file;
}

/**
 * The ffmpeg graph for an announcement's effects, from the voice ([0:a]) to
 * a stream labelled [fx]. With reverb, the impulse response is input 1.
 */
async function effectsGraph(o: VoiceEffects): Promise<{ inputs: string[]; graph: string }> {
  const steps = [`aresample=${SAMPLE_RATE}`, "aformat=channel_layouts=mono"];
  if (o.pitch > 0 || o.tempo !== 1) {
    steps.push(`rubberband=pitch=${(2 ** (o.pitch / 12)).toFixed(4)}:tempo=${o.tempo.toFixed(3)}:formant=preserved`);
  }
  if (o.reverb <= 0) return { inputs: [], graph: `[0:a]${steps.join(",")}[fx]` };
  const ir = await impulseResponse(o.reverbSize);
  const tail = 0.8 + 2.7 * o.reverbSize + 0.3;
  // How loud the reverb is under the voice: 5% ≈ -32 dB (a faint touch), 35% ≈ -15 dB, 100% ≈ -6 dB.
  const wet = (0.5 * o.reverb).toFixed(4);
  return {
    inputs: ["-i", ir],
    graph:
      `[0:a]${steps.join(",")},apad=pad_dur=${tail.toFixed(2)},asplit=2[dry][wetin];` +
      // gtype=none: the impulse response is already scaled to unit energy (see impulseResponse).
      `[wetin][1:a]afir=gtype=none[wet];` +
      `[dry][wet]amix=inputs=2:weights=1 ${wet}:normalize=0,` +
      // End the file once the reverb has faded well below the voice (-42 dB), with a short fade so the cut
      // doesn't click: the song stays quiet until the announcement ends, so a long faint tail would hold it down.
      // Done on the reversed audio, so only the end is trimmed.
      "areverse,silenceremove=start_periods=1:start_threshold=-42dB,afade=t=in:d=0.15,areverse[fx]",
  };
}

/** Integrated loudness, in LUFS (EBU R128), of the voice with its effects. */
async function loudness(file: string, fx: { inputs: string[]; graph: string }): Promise<number> {
  const { err } = await runFull("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", file, ...fx.inputs,
    "-filter_complex", `${fx.graph};[fx]ebur128[out]`,
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
  const fx = await effectsGraph(effects);
  // Effects come first, so the loudness is measured as heard.
  const gainDb = Math.max(-20, Math.min(30, VOICE_LUFS - (await loudness(input, fx))));
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-i", input, ...fx.inputs,
    "-filter_complex",
    `${fx.graph};[fx]volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.84:attack=2:release=50:level=false[out]`,
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
