import { useEffect, useRef, useState, type PointerEvent } from "react";
import { CLIP_LIMITS } from "../../shared/types.ts";

const PEAKS_PER_SECOND = 20;
const HANDLE_HIT_PX = 24;
/** Space at each side so a handle at the very start or end is fully visible. */
const PAD = 11;

interface Props {
  peaks: number[];
  durationMs: number;
  startMs: number;
  endMs: number;
  fadeMs: number;
  /** Position of the playing preview, in ms from the start of the song. */
  playheadMs?: number | null;
  /** Called continuously while dragging. */
  onChange(startMs: number, endMs: number): void;
  /** Called when a drag ends. */
  onCommit(startMs: number, endMs: number): void;
  /** A tap (not a drag) on the waveform: play from this point. */
  onSeek?(ms: number): void;
}

/** "tap" until the finger has moved far enough to count as dragging the clip. */
type Drag = { kind: "start" | "end" | "move" | "tap"; grabMs: number; grabX: number; startMs: number; endMs: number };

/** How far a finger may move and still count as a tap. */
const TAP_SLOP_PX = 8;

/**
 * The whole song as a waveform, with the clip highlighted. Drag the handles
 * to change the start or end, drag the middle to move the clip, or tap
 * anywhere to play from that point.
 */
export function Waveform({ peaks, durationMs, startMs, endMs, fadeMs, playheadMs, onChange, onCommit, onSeek }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ startMs, endMs });
  latest.current = { startMs, endMs };

  useEffect(() => {
    const el = wrap.current!;
    const measure = () => setWidth(el.clientWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const inner = Math.max(1, width - 2 * PAD);
  const msToX = (ms: number) => PAD + (ms / durationMs) * inner;
  const xToMs = (x: number) => Math.max(0, Math.min(durationMs, ((x - PAD) / inner) * durationMs));

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const height = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, height);

    const css = getComputedStyle(c);
    const accent = css.getPropertyValue("--accent").trim() || "#3d9bff";
    const line = css.getPropertyValue("--line").trim() || "#2a2e37";

    // Bars: 2px wide with a 1px gap, each showing the loudest peak it covers.
    const bars = Math.floor(inner / 3);
    const perBar = peaks.length / bars;
    const mid = height / 2;
    for (let b = 0; b < bars; b++) {
      let max = 0;
      const from = Math.floor(b * perBar);
      const to = Math.max(from + 1, Math.floor((b + 1) * perBar));
      for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
      const h = Math.max(2, (max / 255) * (height - 8));
      const ms = ((b + 0.5) * perBar * 1000) / PEAKS_PER_SECOND;
      g.fillStyle = ms >= startMs && ms <= endMs ? accent : line;
      g.fillRect(PAD + b * 3, mid - h / 2, 2, h);
    }

    // Fade-out zone.
    const fadeX = msToX(Math.max(startMs, endMs - fadeMs));
    g.fillStyle = "rgba(61,155,255,0.18)";
    g.fillRect(fadeX, 0, msToX(endMs) - fadeX, height);

    // Handles: a line with a tab at the top.
    g.fillStyle = accent;
    for (const ms of [startMs, endMs]) {
      const x = msToX(ms);
      g.fillRect(x - 1.5, 0, 3, height);
      g.beginPath();
      g.roundRect ? g.roundRect(x - 11, 0, 22, 18, [0, 0, 7, 7]) : g.rect(x - 11, 0, 22, 18);
      g.fill();
    }

    if (playheadMs != null) {
      g.fillStyle = "#f5f6f7";
      g.fillRect(msToX(playheadMs) - 1, 0, 2, height);
    }
  }, [peaks, width, durationMs, startMs, endMs, fadeMs, playheadMs]);

  function localX(e: PointerEvent) {
    return e.clientX - wrap.current!.getBoundingClientRect().left;
  }

  function onDown(e: PointerEvent) {
    const x = localX(e);
    const { startMs: s, endMs: en } = latest.current;
    const ms = xToMs(x);
    let kind: Drag["kind"];
    if (Math.abs(x - msToX(s)) <= HANDLE_HIT_PX && Math.abs(x - msToX(s)) <= Math.abs(x - msToX(en))) kind = "start";
    else if (Math.abs(x - msToX(en)) <= HANDLE_HIT_PX) kind = "end";
    else kind = "tap"; // becomes "move" if it's a drag inside the clip
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { kind, grabMs: ms, grabX: x, startMs: s, endMs: en };
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const x = localX(e);
    if (d.kind === "tap") {
      // Still a tap until it moves; then a drag that started inside the clip moves the clip.
      if (Math.abs(x - d.grabX) < TAP_SLOP_PX) return;
      if (d.grabMs > d.startMs && d.grabMs < d.endMs) d.kind = "move";
      else return;
    }
    const ms = xToMs(x);
    const { minLengthMs, maxLengthMs } = CLIP_LIMITS;
    let s = d.startMs;
    let en = d.endMs;
    if (d.kind === "start") s = Math.max(0, Math.max(en - maxLengthMs, Math.min(ms, en - minLengthMs)));
    else if (d.kind === "end") en = Math.min(durationMs, Math.min(s + maxLengthMs, Math.max(ms, s + minLengthMs)));
    else {
      const len = d.endMs - d.startMs;
      s = Math.max(0, Math.min(durationMs - len, d.startMs + (ms - d.grabMs)));
      en = s + len;
    }
    onChange(Math.round(s), Math.round(en));
  }

  function onUp() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.kind === "tap") {
      onSeek?.(Math.round(d.grabMs));
      return;
    }
    onCommit(latest.current.startMs, latest.current.endMs);
  }

  return (
    <div
      ref={wrap}
      className="waveform"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="img"
      aria-label="Song waveform with the clip highlighted"
    >
      <canvas ref={canvas} />
    </div>
  );
}
