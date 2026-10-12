// Plays walkup clips with the Web Audio API. The player editor's preview and
// game mode both use this, so they sound the same.

export interface PlaybackSettings {
  /** Where the requested start is inside the clip file (after lead-in frames). */
  offsetMs: number;
  /** Audio available in the file after offsetMs. */
  playMs: number;
  startMs: number;
  endMs: number;
  fadeMs: number;
  volume: number;
  gainDb: number;
  /** Gain already written into the file; the phone adds the difference. */
  fileGainDb: number;
  bassDb: number;
  trebleDb: number;
}

const BASS_HZ = 150;
const TREBLE_HZ = 3500;
/** A tiny fade-in so a clip that starts mid-note doesn't click. */
const FADE_IN_SEC = 0.015;
const MIN_STOP_FADE_SEC = 0.3;

/**
 * Volume steps for a fade-out from full to silent. Ears judge loudness on a
 * curve, so a straight-line fade sounds loud for most of its length and then
 * drops away. Squaring the line (about −12 dB halfway) sounds like an even fade.
 */
const FADE_CURVE = Float32Array.from({ length: 128 }, (_, i) => (1 - i / 127) ** 2);

let ctx: AudioContext | null = null;
let iosKeepAlive: HTMLAudioElement | null = null;

function context(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** A short silent WAV, used to switch iOS into "playback" audio mode. */
function silentWavUrl(): string {
  const samples = 4000;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/**
 * Must be called from inside a tap handler. Browsers (iPhone especially) only
 * allow sound to start in response to a user tap.
 *
 * On iPhone, Web Audio is silenced by the ring/silent switch. Playing an
 * ordinary <audio> element switches the phone into "playback" mode, where
 * the switch no longer mutes the app, so we loop a silent one.
 */
export function unlockAudio() {
  const c = context();
  if (c.state !== "running") void c.resume();
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  if (isIOS() && !iosKeepAlive) {
    iosKeepAlive = new Audio(silentWavUrl());
    iosKeepAlive.loop = true;
    iosKeepAlive.setAttribute("playsinline", "");
    void iosKeepAlive.play().catch(() => {
      iosKeepAlive = null;
    });
  }
}

// A decoded 30-second clip takes about 10 MB, too much to keep a whole roster
// decoded on an older iPhone. So every clip's file is kept (about 1 MB each),
// and only the last few used are kept decoded, ready to play instantly.
const MAX_DECODED = 4;
const files = new Map<string, Promise<ArrayBuffer>>();
const decoded = new Map<string, Promise<AudioBuffer>>(); // oldest first

/** Downloads a clip file once and keeps it, without decoding it. */
export function fetchClip(url: string): Promise<ArrayBuffer> {
  let p = files.get(url);
  if (!p) {
    p = fetch(url, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the clip (${r.status}).`);
      return r.arrayBuffer();
    });
    p.catch(() => files.delete(url));
    files.set(url, p);
  }
  return p;
}

/** Returns a clip ready to play, decoding it if it isn't already. */
export function loadClip(url: string): Promise<AudioBuffer> {
  let p = decoded.get(url);
  if (p) {
    decoded.delete(url); // move to the newest end
  } else {
    // decodeAudioData empties the buffer it is given, so it gets a copy.
    p = fetchClip(url).then((data) => context().decodeAudioData(data.slice(0)));
    p.catch(() => decoded.delete(url));
  }
  decoded.set(url, p);
  for (const key of decoded.keys()) {
    if (decoded.size <= MAX_DECODED) break;
    decoded.delete(key);
  }
  return p;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** One playing clip. */
export class Playback {
  private source: AudioBufferSourceNode;
  private bass: BiquadFilterNode;
  private treble: BiquadFilterNode;
  private level: GainNode;
  /** Fade-in, and the fade at the end of the clip. */
  private envelope: GainNode;
  /** The fade when a player taps to stop. Its own node, so it never has to interrupt the envelope's schedule. */
  private stopFader: GainNode;
  private fadingOut = false;
  private startedAt: number;
  private lengthSec: number;
  private stopped = false;
  onEnded: (() => void) | null = null;

  constructor(buffer: AudioBuffer, private settings: PlaybackSettings) {
    const c = context();
    this.source = c.createBufferSource();
    this.source.buffer = buffer;
    this.bass = c.createBiquadFilter();
    this.bass.type = "lowshelf";
    this.bass.frequency.value = BASS_HZ;
    this.treble = c.createBiquadFilter();
    this.treble.type = "highshelf";
    this.treble.frequency.value = TREBLE_HZ;
    this.level = c.createGain();
    this.envelope = c.createGain();
    this.stopFader = c.createGain();
    // Connected one by one: chained connect() calls are not reliable on iOS 15.
    this.source.connect(this.bass);
    this.bass.connect(this.treble);
    this.treble.connect(this.level);
    this.level.connect(this.envelope);
    this.envelope.connect(this.stopFader);
    this.stopFader.connect(c.destination);
    this.applyLive(settings, true);

    const offset = settings.offsetMs / 1000;
    this.lengthSec = Math.max(0.1, Math.min((settings.endMs - settings.startMs) / 1000, settings.playMs / 1000, buffer.duration - offset));
    // The end fade can't overlap the fade-in (Web Audio refuses overlapping curves).
    const fade = Math.min(settings.fadeMs / 1000, this.lengthSec - FADE_IN_SEC);
    const now = c.currentTime + 0.02;
    const g = this.envelope.gain;
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, now + FADE_IN_SEC);
    if (fade > 0) g.setValueCurveAtTime(FADE_CURVE, now + this.lengthSec - fade, fade);
    this.source.start(now, offset, this.lengthSec);
    this.startedAt = now;
    this.source.onended = () => {
      this.stopped = true;
      this.onEnded?.();
    };
  }

  /** Seconds into the clip (from the start point). */
  get position(): number {
    return Math.max(0, Math.min(this.lengthSec, context().currentTime - this.startedAt));
  }

  get playing(): boolean {
    return !this.stopped;
  }

  /** Volume, gain and tone changes are heard straight away. */
  update(settings: Partial<PlaybackSettings>) {
    this.settings = { ...this.settings, ...settings };
    this.applyLive(this.settings, false);
  }

  private applyLive(s: PlaybackSettings, immediate: boolean) {
    const t = context().currentTime;
    const set = (p: AudioParam, v: number) => (immediate ? (p.value = v) : p.setTargetAtTime(v, t, 0.03));
    set(this.level.gain, s.volume * dbToGain(s.gainDb - s.fileGainDb));
    set(this.bass.gain, s.bassDb);
    set(this.treble.gain, s.trebleDb);
  }

  get fading(): boolean {
    return this.fadingOut;
  }

  /** Fades out over the clip's fade length (or the given seconds), then stops. */
  fadeOut(seconds?: number) {
    if (this.stopped || this.fadingOut) return;
    this.fadingOut = true;
    const now = context().currentTime;
    const fade = seconds ?? Math.max(MIN_STOP_FADE_SEC, Math.min(this.settings.fadeMs / 1000, 5));
    this.stopFader.gain.setValueCurveAtTime(FADE_CURVE, now, fade);
    this.source.stop(now + fade + 0.05);
  }

  /** Stops immediately (for example when leaving the screen). */
  stop() {
    if (this.stopped) return;
    this.onEnded = null;
    try {
      this.source.stop();
    } catch {
      // already stopped
    }
    this.stopped = true;
  }
}
