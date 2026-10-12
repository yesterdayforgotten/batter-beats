// Simple stroke icons, sized by the surrounding text.
import { useEffect, useRef } from "react";
import { outputAnalyser } from "../audio/engine.ts";
const common = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const BackIcon = () => (
  <svg {...common} width={24} height={24} strokeWidth={2.4}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const KebabIcon = () => (
  <svg {...common} width={20} height={20} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
  </svg>
);

/** A pencil writing over a box, for "edit". */
export const EditIcon = ({ size = 20 }: { size?: number }) => (
  <svg {...common} width={size} height={size} strokeWidth={1.7}>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.4 2.6a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.4-9.4Z" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...common} width={24} height={24}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

/** Up and down arrows, for "reorder". */
export const ReorderIcon = () => (
  <svg {...common} width={22} height={22} strokeWidth={1.9}>
    <path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5" />
  </svg>
);

export const PlayIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
    <path d="M7 4l13 8-13 8Z" fill="currentColor" />
  </svg>
);

export const ChevronIcon = () => (
  <svg {...common} width={20} height={20}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Per-bar frequency ranges (FFT bins of ~180 Hz, low to high) and how much to lift each (treble is quieter). */
const BANDS: [number, number, number][] = [
  [0, 2, 0.85],
  [2, 6, 0.95],
  [6, 16, 1.25],
  [16, 48, 1.6],
];

/**
 * "Playing now" bars that move with the actual sound, like a visualizer: bass
 * on the left, treble on the right. Falls back to a gentle canned bounce if
 * the sound can't be measured, and stays still for people who reduce motion.
 */
export function SoundBars() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const analyser = outputAnalyser();
    const el = ref.current;
    if (!analyser || !el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.classList.add("live");
    const bars = [...el.children] as HTMLElement[];
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      BANDS.forEach(([from, to, lift], i) => {
        let peak = 0;
        for (let k = from; k < to; k++) peak = Math.max(peak, data[k]);
        const level = Math.min(1, ((peak / 255) * lift) ** 1.6);
        bars[i].style.transform = `scaleY(${Math.max(0.12, level).toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <span className="eq" aria-hidden ref={ref}>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export const GripIcon = () => (
  <svg {...common}>
    <path d="M5 8h14M5 12h14M5 16h14" />
  </svg>
);

export const SkipIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
    <path d="M5 5l10 7-10 7Z" fill="currentColor" />
    <rect x="16.5" y="5" width="3" height="14" rx="1.2" fill="currentColor" />
  </svg>
);

export const StopIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
    <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...common} width={16} height={16} strokeWidth={3}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
