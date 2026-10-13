import { useEffect, useRef, useState } from "react";
import { onOfflineChange, teamDownloads } from "../offline.ts";
import { onPlaylistChange, songDownloads } from "../playlist.ts";

/** How long the full bar stays after the last download, and how long a gap between downloads may be. */
const LINGER_MS = 900;

/**
 * A thin bar along the very top of every screen while teams' clips or
 * playlists' songs download for offline use. It shows one overall figure for
 * everything started since it appeared: a team that finishes stays counted as
 * done, so the bar only moves forward while more teams or playlists are added.
 */
export function SyncBar() {
  const [progress, setProgress] = useState<number | null>(null);
  const batch = useRef(new Map<string, { done: number; total: number }>());

  useEffect(() => {
    let hideTimer: number | undefined;
    const update = () => {
      const active = [...teamDownloads(), ...songDownloads()].filter((d) => d.total > 0);
      const keys = new Set(active.map((d) => d.key));
      for (const [key, d] of batch.current) if (!keys.has(key)) d.done = d.total; // finished
      for (const d of active) batch.current.set(d.key, { done: d.done, total: d.total });
      if (batch.current.size === 0) return;
      let done = 0;
      let total = 0;
      for (const d of batch.current.values()) {
        done += d.done;
        total += d.total;
      }
      setProgress(done / total);
      window.clearTimeout(hideTimer);
      if (active.length === 0) {
        // Everything is in: show it full for a moment, then start afresh next time.
        hideTimer = window.setTimeout(() => {
          batch.current.clear();
          setProgress(null);
        }, LINGER_MS);
      }
    };
    update();
    const stops = [onOfflineChange(update), onPlaylistChange(update)];
    return () => {
      stops.forEach((stop) => stop());
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (progress === null) return null;
  const pct = Math.round(progress * 100);
  return (
    <div
      className="sync-bar"
      role="progressbar"
      aria-label="Saving for offline use"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div className="sync-bar-fill" style={{ width: `${Math.max(pct, 4)}%` }} />
    </div>
  );
}
