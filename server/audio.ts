import fs from "node:fs";
import { spawn } from "node:child_process";

/** Runs a command and returns its standard output as a Buffer. */
function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
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
