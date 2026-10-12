// Simple stroke icons, sized by the surrounding text.
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

export const SoundBars = () => (
  <span className="eq" aria-hidden>
    <span />
    <span />
    <span />
    <span />
  </span>
);

export const GripIcon = () => (
  <svg {...common}>
    <path d="M5 8h14M5 12h14M5 16h14" />
  </svg>
);
