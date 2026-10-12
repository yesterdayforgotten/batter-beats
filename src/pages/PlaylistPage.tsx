import { useEffect, useMemo, useRef, useState } from "react";
import { api, upload } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { CheckIcon } from "../components/Icons.tsx";
import { PageHead } from "../components/PageHead.tsx";
import {
  keepsPlaylist,
  loadPlaylist,
  onPlaylistChange,
  savePlaylist,
  setKeepPlaylist,
  songDownloadProgress,
  storedSongIds,
} from "../playlist.ts";
import type { PlaylistSong, Song } from "../../shared/types.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const formatSize = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

/** Your between-innings playlist: songs from the shared library, played shuffled in game mode. */
export function PlaylistPage() {
  const { user } = useAuth();
  const editor = hasRole(user, "editor");
  const [songs, setSongs] = useState<PlaylistSong[] | null>(null);
  const [library, setLibrary] = useState<Song[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPlaylist()
      .then((r) => {
        setSongs(r.songs);
        setOffline(r.offline);
      })
      .catch((err) => setError(err.message));
    api<{ songs: Song[] }>("/songs", { timeoutMs: 6000 })
      .then((r) => setLibrary(r.songs))
      .catch(() => setLibrary(null));
  }, []);

  const inList = useMemo(() => new Set(songs?.map((s) => s.id)), [songs]);
  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (library ?? []).filter((s) => !inList.has(s.id) && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)));
  }, [library, inList, query]);

  async function save(ids: number[]) {
    try {
      setSongs(await savePlaylist(ids));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file || !songs) return;
    setError(null);
    setUploading(0);
    try {
      const r = await upload<{ song: Song }>("/songs", file, setUploading);
      setLibrary((l) => [...(l ?? []), r.song]);
      await save([...songs.map((s) => s.id), r.song.id]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <>
      <PageHead back="/" title={<div className="display" style={{ fontSize: 30 }}>Playlist</div>} />
      <p className="muted small" style={{ margin: "0 4px 14px" }}>
        Your songs for between innings. In game mode they play shuffled, and fade out when you tap a batter.
      </p>
      {offline && <p className="notice">No connection. Showing your playlist as last saved on this phone.</p>}
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {songs && songs.length > 0 && <KeepOnPhone songs={songs} />}

      <div className="section-title" style={{ margin: "18px 4px 8px" }}>
        Your songs {songs ? `(${songs.length})` : ""}
      </div>
      {songs?.length === 0 && <p className="empty">No songs yet. Add some from the library below.</p>}
      <ul className="list">
        {songs?.map((s) => (
          <li key={s.id} className="list-item">
            <div className="player-row">
              <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="player-name truncate">{s.title}</span>
                <span className="muted small truncate">
                  {s.artist ? `${s.artist} · ` : ""}
                  {formatLength(s.durationMs)}
                </span>
              </span>
              {!offline && (
                <button className="small-button" onClick={() => save(songs.filter((x) => x.id !== s.id).map((x) => x.id))}>
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!offline && library && (
        <>
          <div className="section-title" style={{ margin: "22px 4px 8px" }}>
            Add from the library
          </div>
          {editor && (
            <>
              <button
                className="add-button"
                style={{ marginBottom: 8 }}
                disabled={uploading !== null}
                onClick={() => fileInput.current?.click()}
              >
                {uploading === null
                  ? "+ Upload an MP3"
                  : uploading < 1
                    ? `Uploading… ${Math.round(uploading * 100)}%`
                    : "Adding to the library…"}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/mpeg,.mp3"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </>
          )}
          {library.length > 6 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the library"
              aria-label="Search the library"
              style={{ marginBottom: 8 }}
            />
          )}
          {available.length === 0 && (
            <p className="empty">{library.length === 0 ? "The library is empty." : "Every song is already in your playlist."}</p>
          )}
          <ul className="list">
            {available.map((s) => (
              <li key={s.id} className="list-item">
                <div className="player-row">
                  <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                    <span className="player-name truncate">{s.title}</span>
                    <span className="muted small truncate">
                      {s.artist ? `${s.artist} · ` : ""}
                      {formatLength(s.durationMs)}
                    </span>
                  </span>
                  <button className="small-button primary" onClick={() => songs && save([...songs.map((x) => x.id), s.id])}>
                    Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Switch to keep the playlist's songs on this phone, with the space it takes. */
function KeepOnPhone({ songs }: { songs: PlaylistSong[] }) {
  const [keep, setKeep] = useState(keepsPlaylist);
  const [stored, setStored] = useState<number>(0);
  const [progress, setProgress] = useState(songDownloadProgress);
  const [busy, setBusy] = useState(false);
  const total = songs.reduce((sum, s) => sum + s.sizeBytes, 0);

  useEffect(() => {
    let live = true;
    const update = async () => {
      const ids = await storedSongIds(songs);
      if (!live) return;
      setKeep(keepsPlaylist());
      setStored(ids.size);
      setProgress(songDownloadProgress());
    };
    void update();
    const stop = onPlaylistChange(() => void update());
    return () => {
      live = false;
      stop();
    };
  }, [songs]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await setKeepPlaylist(!keep);
    } catch (err) {
      alert(`Couldn't keep the songs on this phone. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const ready = keep && stored === songs.length;
  return (
    <div className="card row">
      <span className="stack grow" style={{ gap: 2 }}>
        <span style={{ fontWeight: 800 }}>Keep on this phone</span>
        <span className="muted small">
          {progress
            ? `Downloading ${progress.done} of ${progress.total}…`
            : ready
              ? `All ${songs.length} songs saved · ${formatSize(total)}`
              : `Plays without a connection · uses ${formatSize(total)}`}
        </span>
      </span>
      <button role="switch" aria-checked={keep} aria-label="Keep playlist on this phone" className={`switch${keep ? " on" : ""}`} onClick={toggle}>
        {ready && (
          <span className="switch-label">
            <CheckIcon />
          </span>
        )}
        <span className="switch-track">
          <span className="switch-knob" />
        </span>
      </button>
    </div>
  );
}
