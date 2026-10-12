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

export const EditIcon = () => (
  <svg {...common} width={20} height={20} strokeWidth={2}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
