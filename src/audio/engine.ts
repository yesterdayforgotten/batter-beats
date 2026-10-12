// Plays walkup clips with the Web Audio API. The player editor's preview and
// game mode both use this, so they sound the same.

import { CLIP_CACHE } from "../offline.ts";
import { ANNOUNCER } from "../../shared/types.ts";

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
export const FADE_CURVE = Float32Array.from({ length: 128 }, (_, i) => (1 - i / 127) ** 2);

let ctx: AudioContext | null = null;
let iosKeepAlive: HTMLAudioElement | null = null;

export function context(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

let out: { input: GainNode; analyser: AnalyserNode } | null = null;

/**
 * Where every sound (walkups, announcements, the jukebox) goes on its way to
 * the speakers. A tap on it measures what's playing, for the sound bars.
 */
export function output(): AudioNode {
  const c = context();
  if (!out) {
    const input = c.createGain();
    const analyser = c.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    // Connected one by one: chained connect() calls are not reliable on iOS 15.
    input.connect(analyser);
    analyser.connect(c.destination);
    out = { input, analyser };
  }
  return out.input;
}

/** The measuring tap on the output, once any sound has been set up. */
export const outputAnalyser = (): AnalyserNode | null => out?.analyser ?? null;

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
const MAX_DECODED = 6; // about 4 songs plus announcements, which are small
const files = new Map<string, Promise<ArrayBuffer>>();
const decoded = new Map<string, Promise<AudioBuffer>>(); // oldest first

/** Downloads a clip file once and keeps it, without decoding it. */
export function fetchClip(url: string): Promise<ArrayBuffer> {
  let p = files.get(url);
  if (!p) {
    p = (async () => {
      // Clips kept for offline use are read straight from the phone's storage.
      const kept = typeof caches === "undefined" ? undefined : await caches.match(url, { cacheName: CLIP_CACHE, ignoreVary: true });
      const r = kept ?? (await fetch(url, { credentials: "same-origin" }));
      if (!r.ok) throw new Error(`Couldn't load the clip (${r.status}).`);
      return r.arrayBuffer();
    })();
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

/** The announcement played with a clip, and when the song comes in. */
export interface VoiceOver {
  buffer: AudioBuffer;
  /** How long after the voice starts the song starts. */
  songDelayMs: number;
}

/**
 * One walkup: the player's announcement and/or their clip. While the voice
 * speaks the song plays quietly underneath, then rises to full volume.
 */
export class Playback {
  private sources: AudioBufferSourceNode[] = [];
  private bass: BiquadFilterNode | null = null;
  private treble: BiquadFilterNode | null = null;
  private level: GainNode | null = null;
  /** Fade-in, and the fade at the end of the clip. */
  private envelope: GainNode | null = null;
  /** The fade when a player taps to stop. Its own node, so it never has to interrupt the other schedules. */
  private stopFader: GainNode;
  private fadingOut = false;
  /** When the song starts (or the voice, if there's no song). */
  private startedAt: number;
  private lengthSec: number;
  private stopped = false;
  onEnded: (() => void) | null = null;

  constructor(
    buffer: AudioBuffer | null,
    private settings: PlaybackSettings | null,
    voice?: VoiceOver | null,
  ) {
    const c = context();
    this.stopFader = c.createGain();
    this.stopFader.connect(output());
    const now = c.currentTime + 0.02;
    const voiceEnd = voice ? now + voice.buffer.duration : now;

    if (voice) {
      const v = c.createBufferSource();
      v.buffer = voice.buffer;
      v.connect(this.stopFader);
      v.start(now);
      this.sources.push(v);
    }

    this.startedAt = now;
    this.lengthSec = voice ? voice.buffer.duration : 0;

    if (buffer && settings) {
      const songStart = now + (voice ? voice.songDelayMs / 1000 : 0);
      const source = c.createBufferSource();
      source.buffer = buffer;
      this.bass = c.createBiquadFilter();
      this.bass.type = "lowshelf";
      this.bass.frequency.value = BASS_HZ;
      this.treble = c.createBiquadFilter();
      this.treble.type = "highshelf";
      this.treble.frequency.value = TREBLE_HZ;
      this.level = c.createGain();
      this.envelope = c.createGain();
      const duck = c.createGain();
      // Connected one by one: chained connect() calls are not reliable on iOS 15.
      source.connect(this.bass);
      this.bass.connect(this.treble);
      this.treble.connect(this.level);
      this.level.connect(this.envelope);
      this.envelope.connect(duck);
      duck.connect(this.stopFader);
      this.applyLive(settings, true);

      // Under the voice: quiet, then up to full volume once the voice ends.
      if (voice && voiceEnd > songStart) {
        duck.gain.setValueAtTime(ANNOUNCER.duckGain, now);
        duck.gain.setValueAtTime(ANNOUNCER.duckGain, voiceEnd);
        duck.gain.linearRampToValueAtTime(1, voiceEnd + ANNOUNCER.duckReleaseMs / 1000);
      }

      const offset = settings.offsetMs / 1000;
      this.lengthSec = Math.max(
        0.1,
        Math.min((settings.endMs - settings.startMs) / 1000, settings.playMs / 1000, buffer.duration - offset),
      );
      // The end fade can't overlap the fade-in (Web Audio refuses overlapping curves).
      const fade = Math.min(settings.fadeMs / 1000, this.lengthSec - FADE_IN_SEC);
      const g = this.envelope.gain;
      g.setValueAtTime(0, songStart);
      g.linearRampToValueAtTime(1, songStart + FADE_IN_SEC);
      if (fade > 0) g.setValueCurveAtTime(FADE_CURVE, songStart + this.lengthSec - fade, fade);
      source.start(songStart, offset, this.lengthSec);
      this.sources.push(source);
      this.startedAt = songStart;
    }

    // Finished when every part has finished.
    let left = this.sources.length;
    for (const src of this.sources) {
      src.onended = () => {
        if (--left > 0) return;
        this.stopped = true;
        this.onEnded?.();
      };
    }
    if (left === 0) this.stopped = true;
  }

  /** Seconds into the song (from its start point); 0 while only the voice is playing. */
  get position(): number {
    return Math.max(0, Math.min(this.lengthSec, context().currentTime - this.startedAt));
  }

  get playing(): boolean {
    return !this.stopped;
  }

  /** Volume, gain and tone changes are heard straight away. */
  update(settings: Partial<PlaybackSettings>) {
    if (!this.settings) return;
    this.settings = { ...this.settings, ...settings };
    this.applyLive(this.settings, false);
  }

  private applyLive(s: PlaybackSettings, immediate: boolean) {
    if (!this.level || !this.bass || !this.treble) return;
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
    const fade = seconds ?? Math.max(MIN_STOP_FADE_SEC, Math.min((this.settings?.fadeMs ?? 0) / 1000, 5));
    this.stopFader.gain.setValueCurveAtTime(FADE_CURVE, now, fade);
    for (const src of this.sources) {
      try {
        src.stop(now + fade + 0.05);
      } catch {
        // already stopped
      }
    }
  }

  /** Stops immediately (for example when leaving the screen). */
  stop() {
    if (this.stopped) return;
    this.onEnded = null;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.stopped = true;
  }
}
