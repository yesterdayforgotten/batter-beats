import type { CSSProperties } from "react";
import { teamColor } from "../shared/types.ts";

/** Lighter version of a colour (for links and highlights), mixed towards white. */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Style for a wrapper that recolours everything inside it, in place of the app's blue, with the team's colour. */
export function teamStyle(color: string | undefined): CSSProperties {
  const c = teamColor(color);
  return {
    "--accent": c.accent,
    "--accent-ink": c.ink,
    "--accent-soft": lighten(c.accent, 0.45),
  } as CSSProperties;
}
