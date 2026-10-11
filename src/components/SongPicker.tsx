import { useEffect, useMemo, useRef, useState } from "react";
import { api, upload } from "../api.ts";
import type { Song } from "../../shared/types.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Bottom sheet: pick a song from the shared library, or upload a new MP3. */
export function SongPicker({ selectedId, onPick, onClose }: { selectedId?: number; onPick(song: Song): void; onClose(): void }) {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ songs: Song[] }>("/songs")
      .then((r) => setSongs(r.songs))
      .catch((err) => setError(err.message));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!songs || !q) return songs ?? [];
    return songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q));
  }, [songs, query]);

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
        {songs && songs.length > 6 && (
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the library" aria-label="Search the library" />
        )}
        <div className="sheet-list">
          {songs && songs.length === 0 && <p className="empty">The library is empty. Upload the first song.</p>}
          {shown.map((s) => (
            <button key={s.id} className={`song-option ${s.id === selectedId ? "selected" : ""}`} onClick={() => onPick(s)}>
              <span className="title">{s.title}</span>
              <span className="artist">
                {s.artist ? `${s.artist} · ` : ""}
                {formatLength(s.durationMs)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
