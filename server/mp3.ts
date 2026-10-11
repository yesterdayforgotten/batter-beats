// Minimal MPEG audio Layer III frame scanner. Used to cut clips by copying
// whole frames, so the audio is never decoded or re-encoded.

export interface Mp3Frame {
  offset: number;
  length: number;
}

export interface Mp3Info {
  frames: Mp3Frame[];
  sampleRate: number;
  samplesPerFrame: number;
  /** Seconds per frame. */
  frameDuration: number;
  durationSec: number;
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

interface Header {
  version: number;
  sampleRate: number;
  samplesPerFrame: number;
  length: number;
  channels: number;
}

function parseHeader(buf: Buffer, i: number): Header | null {
  if (i + 4 > buf.length) return null;
  if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[i + 1] >> 3) & 0x03;
  const layer = (buf[i + 1] >> 1) & 0x03;
  if (version === 1 || layer !== 1) return null; // reserved version, or not Layer III
  const bitrateIndex = (buf[i + 2] >> 4) & 0x0f;
  const rateIndex = (buf[i + 2] >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const padding = (buf[i + 2] >> 1) & 0x01;
  const channels = ((buf[i + 3] >> 6) & 0x03) === 3 ? 1 : 2;
  const isV1 = version === 3;
  const bitrate = (isV1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samplesPerFrame = isV1 ? 1152 : 576;
  const length = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;
  return { version, sampleRate, samplesPerFrame, length, channels };
}

function id3v2Size(buf: Buffer): number {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return 0;
  const size =
    ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const hasFooter = (buf[5] & 0x10) !== 0;
  return 10 + size + (hasFooter ? 10 : 0);
}

/** True when the frame is a Xing/Info/VBRI header frame, which holds no audio. */
function isInfoFrame(buf: Buffer, frame: Mp3Frame, header: Header): boolean {
  const sideInfo = header.version === 3 ? (header.channels === 1 ? 17 : 32) : header.channels === 1 ? 9 : 17;
  const tagAt = frame.offset + 4 + sideInfo;
  const tag = buf.toString("latin1", tagAt, tagAt + 4);
  if (tag === "Xing" || tag === "Info") return true;
  return buf.toString("latin1", frame.offset + 36, frame.offset + 40) === "VBRI";
}

/**
 * Scans an MP3 file's audio frames. Throws if the data is not an MP3 with a
 * consistent stream of Layer III frames.
 */
export function scanMp3(buf: Buffer): Mp3Info {
  let i = id3v2Size(buf);
  // Find the first frame that is followed by another valid frame, so stray
  // sync-like bytes in leftover tag data are not mistaken for audio.
  let first: Header | null = null;
  for (; i < buf.length - 4; i++) {
    const h = parseHeader(buf, i);
    if (!h) continue;
    const next = parseHeader(buf, i + h.length);
    if (next && next.sampleRate === h.sampleRate && next.version === h.version) {
      first = h;
      break;
    }
  }
  if (!first) throw new Error("No MP3 audio found in this file.");

  const frames: Mp3Frame[] = [];
  let firstHeader: Header | null = null;
  while (i < buf.length - 4) {
    const h = parseHeader(buf, i);
    if (!h || h.sampleRate !== first.sampleRate || h.version !== first.version) {
      // Allow a little junk between frames, otherwise stop (ID3v1/APE tags).
      if (buf.toString("latin1", i, i + 3) === "TAG" || buf.toString("latin1", i, i + 8) === "APETAGEX") break;
      let resynced = false;
      for (let j = i + 1; j < Math.min(i + 2048, buf.length - 4); j++) {
        const r = parseHeader(buf, j);
        if (r && r.sampleRate === first.sampleRate && r.version === first.version && parseHeader(buf, j + r.length)) {
          i = j;
          resynced = true;
          break;
        }
      }
      if (!resynced) break;
      continue;
    }
    if (i + h.length > buf.length) break;
    const frame = { offset: i, length: h.length };
    if (frames.length === 0 && !firstHeader) {
      firstHeader = h;
      if (isInfoFrame(buf, frame, h)) {
        i += h.length;
        continue;
      }
    }
    frames.push(frame);
    i += h.length;
  }
  if (frames.length < 10) throw new Error("This MP3 file is too short or damaged.");

  const frameDuration = first.samplesPerFrame / first.sampleRate;
  return {
    frames,
    sampleRate: first.sampleRate,
    samplesPerFrame: first.samplesPerFrame,
    frameDuration,
    durationSec: frames.length * frameDuration,
  };
}

/** Frames copied before the requested start, then skipped at playback. See cutClip. */
export const PREROLL_FRAMES = 4;

export interface CutResult {
  data: Buffer;
  /** Seconds from the start of the cut file to the requested start point. */
  offsetSec: number;
  /** Seconds of audio from the requested start to the end of the cut file. */
  playSec: number;
}

/**
 * Copies the frames covering [startSec, endSec) into a new buffer, unchanged.
 *
 * An MP3 frame can borrow data from the frames before it (the "bit
 * reservoir"), and the decoder blends each frame with the one before. The
 * first frames of a cut can therefore decode as a glitch. We copy a few extra
 * frames before the start point and the phone starts playback after them.
 */
export function cutClip(buf: Buffer, info: Mp3Info, startSec: number, endSec: number): CutResult {
  const { frames, frameDuration } = info;
  const startFrame = Math.min(frames.length - 1, Math.max(0, Math.floor(startSec / frameDuration)));
  const firstFrame = Math.max(0, startFrame - PREROLL_FRAMES);
  const endFrame = Math.min(frames.length, Math.max(startFrame + 1, Math.ceil(endSec / frameDuration) + 1));
  const parts = frames.slice(firstFrame, endFrame).map((f) => buf.subarray(f.offset, f.offset + f.length));
  const offsetSec = startSec - firstFrame * frameDuration;
  return {
    data: Buffer.concat(parts),
    offsetSec,
    playSec: (endFrame - firstFrame) * frameDuration - offsetSec,
  };
}
