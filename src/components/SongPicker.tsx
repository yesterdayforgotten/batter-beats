import { useEffect, useMemo, useRef, useState } from "react";
import { api, upload } from "../api.ts";
import { SongFilterBar, useSongFilter } from "./SongFilter.tsx";
import type { RosterSummary, Song } from "../../shared/types.ts";
import { useLockPageScroll } from "../lockScroll.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * Bottom sheet: pick a song from the shared library, or upload a new MP3.
 * Songs tagged with the player's name or team come first.
 */
export function SongPicker({
  selectedId,
  player,
  onPick,
  onClose,
}: {
  selectedId?: number;
  player?: { name: string; rosterId: number };
  onPick(song: Song): void;
  onClose(): void;
}) {
  useLockPageScroll();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const filter = useSongFilter(songs);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ songs: Song[] }>("/songs")
      .then((r) => setSongs(r.songs))
      .catch((err) => setError(err.message));
    if (player) {
      api<{ rosters: RosterSummary[] }>("/rosters")
        .then((r) => setTeamName(r.rosters.find((t) => t.id === player.rosterId)?.name ?? null))
        .catch(() => {});
    }
  }, [player?.rosterId]);

  // Songs tagged for this player (their name or team), shown first.
  const forPlayer = useMemo(() => {
    const names = [player?.name, teamName].filter((n): n is string => !!n).map((n) => n.toLowerCase());
    return new Set(filter.shown.filter((s) => s.tags.some((t) => names.includes(t.toLowerCase()))).map((s) => s.id));
  }, [filter.shown, player?.name, teamName]);
  const tagged = filter.shown.filter((s) => forPlayer.has(s.id));
  const rest = filter.shown.filter((s) => !forPlayer.has(s.id));

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const r = await upload<{ song: Song }>("/songs", file, setProgress);
      onPick(r.song);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Choose a song" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span className="section-title grow">Choose a song</span>
          <button className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
        <button className="primary" disabled={progress !== null} onClick={() => fileInput.current?.click()}>
          {progress === null ? "Upload an MP3" : progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Preparing waveform…"}
        </button>
        {progress !== null && (
          <div className="progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/mpeg,.mp3"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {error && <p className="error">{error}</p>}
        {songs && songs.length > 0 && <SongFilterBar filter={filter} />}
        <div className="sheet-list">
          {songs && songs.length === 0 && <p className="empty">The library is empty. Upload the first song.</p>}
          {songs && songs.length > 0 && filter.shown.length === 0 && <p className="empty">No songs match.</p>}
          {tagged.length > 0 && (
            <>
              <span className="faint small sheet-group">Tagged for {player?.name}{teamName ? ` or ${teamName}` : ""}</span>
              {tagged.map((s) => (
                <SongOption key={s.id} song={s} selected={s.id === selectedId} onPick={onPick} />
              ))}
              {rest.length > 0 && <span className="faint small sheet-group">All songs</span>}
            </>
          )}
          {rest.map((s) => (
            <SongOption key={s.id} song={s} selected={s.id === selectedId} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SongOption({ song, selected, onPick }: { song: Song; selected: boolean; onPick(song: Song): void }) {
  return (
    <button className={`song-option ${selected ? "selected" : ""}`} onClick={() => onPick(song)}>
      <span className="title">{song.title}</span>
      <span className="artist">
        {song.artist ? `${song.artist} · ` : ""}
        {formatLength(song.durationMs)}
        {song.tags.length > 0 ? ` · ${song.tags.join(", ")}` : ""}
      </span>
    </button>
  );
}
