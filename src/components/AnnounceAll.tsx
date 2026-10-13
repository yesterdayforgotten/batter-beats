import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { loadClip, Playback, unlockAudio } from "../audio/engine.ts";
import { SoundBars, StopIcon } from "./Icons.tsx";
import type { Player } from "../../shared/types.ts";

const GAP_MS = 700;

/**
 * "Play all announcements": every player's announcement in batting order, to
 * catch a mispronounced name or a stray laugh in one pass. Remake gives the
 * current player a fresh take and plays it, then carries on.
 */
export function useAnnounceAll(players: Player[], onPlayerChanged: (p: Player) => void) {
  const [index, setIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  const playback = useRef<Playback | null>(null);
  const list = useRef<Player[]>([]);

  const stop = () => {
    token.current++;
    playback.current?.stop();
    playback.current = null;
    setIndex(null);
    setBusy(false);
  };
  useEffect(() => () => stop(), []); // leaving the screen stops it

  /** Plays one announcement; resolves when it has finished (or false if stopped meanwhile). */
  async function playOne(p: Player, t: number): Promise<boolean> {
    if (!p.announcement) return t === token.current;
    const buffer = await loadClip(p.announcement.url);
    if (t !== token.current) return false;
    await new Promise<void>((resolve) => {
      const pb = new Playback(null, null, { buffer, songDelayMs: 0 });
      playback.current = pb;
      pb.onEnded = () => resolve();
      if (!pb.playing) resolve();
    });
    playback.current = null;
    return t === token.current;
  }

  async function runFrom(start: number, t: number) {
    for (let i = start; i < list.current.length; i++) {
      if (t !== token.current) return;
      setIndex(i);
      try {
        if (!(await playOne(list.current[i], t))) return;
      } catch (err) {
        setError(`${list.current[i].name}'s announcement didn't play. ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    if (t === token.current) stop();
  }

  function start() {
    unlockAudio(); // must start inside the tap
    stop();
    setError(null);
    list.current = players.filter((p) => p.announcement);
    if (list.current.length === 0) {
      setError("No announcements are ready yet.");
      return;
    }
    void runFrom(0, ++token.current);
  }

  /** A fresh take for the player being announced, played straight away; then the rest carry on. */
  async function remake() {
    if (index === null) return;
    unlockAudio();
    const i = index;
    const t = ++token.current;
    playback.current?.stop();
    playback.current = null;
    setBusy(true);
    try {
      const r = await api<{ player: Player }>(`/players/${list.current[i].id}/announcement/remake`, {
        method: "POST",
        body: {},
      });
      if (t !== token.current) return;
      list.current = list.current.map((p, k) => (k === i ? r.player : p));
      onPlayerChanged(r.player);
      setBusy(false);
      void runFrom(i, t);
    } catch (err) {
      if (t !== token.current) return;
      setError((err as Error).message);
      stop();
    }
  }

  const current = index === null ? null : list.current[index];
  const skipped = players.length - list.current.length;
  return {
    playing: index !== null,
    current,
    index,
    total: list.current.length,
    skipped,
    busy,
    error,
    start,
    stop,
    remake,
  };
}

/** The bar shown while announcements play: who's on, Remake, Stop. */
export function AnnounceAllBar({ run }: { run: ReturnType<typeof useAnnounceAll> }) {
  if (!run.playing && !run.error) return null;
  if (!run.playing)
    return (
      <p className="error" role="alert">
        {run.error}
      </p>
    );
  const p = run.current!;
  return (
    <div className="announce-all-bar" role="status">
      <SoundBars />
      <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
        <span className="truncate" style={{ fontWeight: 800 }}>
          {p.number ? `#${p.number} ` : ""}
          {p.name}
        </span>
        <span className="muted small">
          {run.busy ? "Making a new take…" : `${(run.index ?? 0) + 1} of ${run.total}`}
          {run.skipped > 0 ? ` · ${run.skipped} not ready` : ""}
        </span>
      </span>
      <button className="small-button" disabled={run.busy} onClick={() => void run.remake()}>
        Remake
      </button>
      <button className="icon-button" aria-label="Stop the announcements" onClick={run.stop}>
        <StopIcon />
      </button>
    </div>
  );
}
