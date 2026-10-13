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
  /** The part of the song shown (zoomed in); the whole song if left out. */
  viewStartMs?: number;
  viewEndMs?: number;
  /** Called continuously while dragging. */
  onChange(startMs: number, endMs: number): void;
  /** Called when a drag ends. */
  onCommit(startMs: number, endMs: number): void;
  /** A tap (not a drag) on the waveform: play from this point. */
  onSeek?(ms: number): void;
}

/** A handle being dragged, or the playhead being placed (a tap, or a drag along the waveform). */
type Drag = { kind: "start" | "end" | "seek"; grabMs: number; startMs: number; endMs: number };

/**
 * The song as a waveform (all of it, or the part zoomed in on), with the clip
 * highlighted. Drag the handles to change the start or end; tap or drag
 * anywhere else to place the playhead (playback jumps there when the finger lifts).
 */
export function Waveform({
  peaks,
  durationMs,
  startMs,
  endMs,
  fadeMs,
  playheadMs,
  viewStartMs = 0,
  viewEndMs = durationMs,
  onChange,
  onCommit,
  onSeek,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<Drag | null>(null);
  /** Where the playhead is being dragged to (shown instead of the playing position). */
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const shownPlayhead = scrubMs ?? playheadMs;
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
  const viewMs = Math.max(1, viewEndMs - viewStartMs);
  const msToX = (ms: number) => PAD + ((ms - viewStartMs) / viewMs) * inner;
  const xToMs = (x: number) => Math.max(viewStartMs, Math.min(viewEndMs, viewStartMs + ((x - PAD) / inner) * viewMs));

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
    const perBar = ((viewMs / 1000) * PEAKS_PER_SECOND) / bars;
    const first = (viewStartMs / 1000) * PEAKS_PER_SECOND;
    const mid = height / 2;
    for (let b = 0; b < bars; b++) {
      let max = 0;
      const from = Math.floor(first + b * perBar);
      const to = Math.max(from + 1, Math.floor(first + (b + 1) * perBar));
      for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
      const h = Math.max(2, (max / 255) * (height - 8));
      const ms = ((first + (b + 0.5) * perBar) * 1000) / PEAKS_PER_SECOND;
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

    if (shownPlayhead != null) {
      g.fillStyle = "#f5f6f7";
      g.fillRect(msToX(shownPlayhead) - 1, 0, 2, height);
    }
  }, [peaks, width, durationMs, startMs, endMs, fadeMs, shownPlayhead, viewStartMs, viewEndMs]);

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
    else kind = "seek";
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { kind, grabMs: ms, startMs: s, endMs: en };
    if (kind === "seek") setScrubMs(Math.round(ms));
  }

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const x = localX(e);
    const ms = xToMs(x);
    if (d.kind === "seek") {
      setScrubMs(Math.round(ms)); // the playhead follows the finger
      return;
    }
    const { minLengthMs, maxLengthMs } = CLIP_LIMITS;
    let s = d.startMs;
    let en = d.endMs;
    if (d.kind === "start") s = Math.max(0, Math.max(en - maxLengthMs, Math.min(ms, en - minLengthMs)));
    else en = Math.min(durationMs, Math.min(s + maxLengthMs, Math.max(ms, s + minLengthMs)));
    onChange(Math.round(s), Math.round(en));
  }

  function onUp() {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.kind === "seek") {
      const ms = scrubMs ?? Math.round(d.grabMs);
      setScrubMs(null);
      onSeek?.(ms);
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

/**
 * Under a zoomed waveform: the whole song as a slim strip, the clip marked on
 * it, and a box for the part shown above. Drag the box (or tap the strip) to
 * look at another part.
 */
export function WaveOverview({
  durationMs,
  startMs,
  endMs,
  viewStartMs,
  viewEndMs,
  playheadMs,
  onPan,
}: {
  durationMs: number;
  startMs: number;
  endMs: number;
  viewStartMs: number;
  viewEndMs: number;
  playheadMs?: number | null;
  /** Asks for the view to start here (the caller keeps it inside the song). */
  onPan(viewStartMs: number): void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null); // where in the box the finger is, in ms
  const pct = (ms: number) => `${(ms / durationMs) * 100}%`;
  const msAt = (e: PointerEvent) => {
    const r = strip.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * durationMs;
  };
  const viewMs = viewEndMs - viewStartMs;
  return (
    <div
      ref={strip}
      className="wave-overview"
      onPointerDown={(e) => {
        const ms = msAt(e);
        (e.target as Element).setPointerCapture(e.pointerId);
        // On the box: drag it from where it was grabbed. Elsewhere: centre it there.
        grab.current = ms >= viewStartMs && ms <= viewEndMs ? ms - viewStartMs : viewMs / 2;
        onPan(ms - grab.current);
      }}
      onPointerMove={(e) => grab.current !== null && onPan(msAt(e) - grab.current)}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
      role="slider"
      aria-label="Part of the song shown"
      aria-valuemin={0}
      aria-valuemax={Math.round((durationMs - viewMs) / 1000)}
      aria-valuenow={Math.round(viewStartMs / 1000)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onPan(viewStartMs - viewMs / 4);
        if (e.key === "ArrowRight") onPan(viewStartMs + viewMs / 4);
      }}
    >
      <span className="wave-overview-clip" style={{ left: pct(startMs), width: pct(endMs - startMs) }} />
      {playheadMs != null && <span className="wave-overview-playhead" style={{ left: pct(playheadMs) }} />}
      <span className="wave-overview-view" style={{ left: pct(viewStartMs), width: pct(viewMs) }} />
    </div>
  );
}
