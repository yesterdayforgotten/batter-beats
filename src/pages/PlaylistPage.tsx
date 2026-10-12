import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { CheckIcon, ChevronIcon } from "../components/Icons.tsx";
import { PageHead } from "../components/PageHead.tsx";
import { SortableList } from "../components/SortableList.tsx";
import { SongFilterBar, useSongFilter } from "../components/SongFilter.tsx";
import { useLockPageScroll } from "../lockScroll.ts";
import {
  createPlaylist,
  deletePlaylist,
  keepsPlaylist,
  loadPlaylists,
  onPlaylistChange,
  renamePlaylist,
  savedPlaylists,
  setKeepPlaylist,
  setPlaylistSongs,
  songDownloadProgress,
  storedSongIds,
} from "../playlist.ts";
import type { Playlist, PlaylistSong, Song } from "../../shared/types.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const formatSize = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
const totalLength = (songs: PlaylistSong[]) => formatLength(songs.reduce((t, s) => t + s.durationMs, 0));
const summary = (p: Playlist) =>
  `${p.songs.length} ${p.songs.length === 1 ? "song" : "songs"}${p.songs.length ? ` · ${totalLength(p.songs)}` : ""}`;

/** Every playlist, shared by everyone; editors add and change them. */
export function PlaylistsPage() {
  const { user } = useAuth();
  const editor = hasRole(user, "editor");
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    loadPlaylists()
      .then((r) => {
        setPlaylists(r.playlists);
        setOffline(r.offline);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const p = await createPlaylist(name);
      navigate(`/playlists/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHead title={<div className="display" style={{ fontSize: 30 }}>Playlists</div>} />
      <p className="muted small" style={{ margin: "0 4px 14px" }}>
        Music for between innings and warm-ups, shared by everyone. Play them from the Jukebox tab in game mode.
      </p>
      {offline && <p className="notice">No connection. Showing the playlists as last saved on this phone.</p>}
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {playlists?.length === 0 && <p className="empty">{editor ? "No playlists yet. Make the first one below." : "No playlists yet."}</p>}
      <ul className="list">
        {playlists?.map((p) => (
          <li key={p.id} className="list-item">
            <Link to={`/playlists/${p.id}`}>
              <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="player-name truncate">{p.name}</span>
                <span className="muted small">
                  {summary(p)}
                  {keepsPlaylist(p.id) ? " · on this phone" : ""}
                </span>
              </span>
              <span className="muted">
                <ChevronIcon />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {editor && !offline && (
        <div style={{ marginTop: 8 }}>
          {naming ? (
            <form className="card stack" onSubmit={create}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name, e.g. Warm-up" maxLength={80} autoFocus required />
              <div className="row">
                <button className="primary">Create playlist</button>
                <button type="button" onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="add-button" onClick={() => setNaming(true)}>
              + New playlist
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** One playlist: its songs in order (editors add, remove, reorder and rename), and keeping it on this phone. */
export function PlaylistEditPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const editor = hasRole(user, "editor");
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<Playlist | null>(() => savedPlaylists().find((p) => p.id === Number(id)) ?? null);
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState(playlist?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const canEdit = editor && !offline;

  useEffect(() => {
    loadPlaylists()
      .then((r) => {
        const p = r.playlists.find((x) => x.id === Number(id)) ?? null;
        setOffline(r.offline);
        setPlaylist(p);
        setName(p?.name ?? "");
        if (!p) setError("This playlist doesn't exist any more.");
      })
      .catch((err) => setError(err.message));
  }, [id]);

  async function save(songIds: number[]) {
    if (!playlist) return;
    try {
      setPlaylist(await setPlaylistSongs(playlist.id, songIds));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveName() {
    if (!playlist || name.trim() === playlist.name) return;
    try {
      const p = await renamePlaylist(playlist.id, name);
      setPlaylist(p);
      setName(p.name);
    } catch (err) {
      setError((err as Error).message);
      setName(playlist.name);
    }
  }

  async function remove() {
    if (!playlist || !confirm(`Delete the playlist "${playlist.name}"? The songs stay in the library.`)) return;
    try {
      await deletePlaylist(playlist.id);
      navigate("/playlists", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHead back="/playlists" eyebrow="Playlist" title={!canEdit && playlist ? <div className="display truncate" style={{ fontSize: 30 }}>{playlist.name}</div> : undefined} />
      {offline && <p className="notice">No connection. Showing the playlist as last saved on this phone.</p>}
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {playlist && (
        <div className="stack" style={{ gap: 12 }}>
          {canEdit && (
            <label>
              Name
              <input
                className="input-large"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                maxLength={80}
              />
            </label>
          )}

          {playlist.songs.length > 0 && <KeepOnPhone playlist={playlist} />}

          <div className="row" style={{ marginTop: 6 }}>
            <span className="section-title">Songs</span>
            <span className="muted small grow">{summary(playlist)}</span>
          </div>
          {playlist.songs.length === 0 && <p className="empty">{canEdit ? "No songs yet. Add some below." : "No songs yet."}</p>}
          <SortableList
            items={playlist.songs}
            keyOf={(s) => s.id}
            sorting={canEdit && playlist.songs.length > 1}
            compact
            onReorder={(songs) => {
              setPlaylist({ ...playlist, songs });
              void save(songs.map((s) => s.id));
            }}
          >
            {(s, i) => (
              <div className="player-row playlist-song">
                <span className="playlist-pos">{i + 1}</span>
                <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                  <span className="song-title truncate">{s.title}</span>
                  <span className="song-meta truncate">
                    {s.artist ? `${s.artist} · ` : ""}
                    {formatLength(s.durationMs)}
                  </span>
                </span>
                {canEdit && (
                  <button
                    className="row-remove"
                    aria-label={`Remove ${s.title}`}
                    onClick={() => save(playlist.songs.filter((x) => x.id !== s.id).map((x) => x.id))}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </SortableList>

          {canEdit && (
            <button className="add-button" onClick={() => setAdding(true)}>
              + Add songs
            </button>
          )}
          {canEdit && (
            <button className="danger" style={{ marginTop: 20, alignSelf: "center" }} onClick={remove}>
              Delete playlist
            </button>
          )}
        </div>
      )}
      {adding && playlist && (
        <AddSongsSheet
          inPlaylist={playlist.songs.map((s) => s.id)}
          onChange={(ids) => save(ids)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

/** Bottom sheet: the library with search and tag filters; tap songs to add them to (or take them out of) the playlist. */
function AddSongsSheet({ inPlaylist, onChange, onClose }: { inPlaylist: number[]; onChange(ids: number[]): void; onClose(): void }) {
  useLockPageScroll();
  const [library, setLibrary] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filter = useSongFilter(library);
  const inList = useMemo(() => new Set(inPlaylist), [inPlaylist]);

  useEffect(() => {
    api<{ songs: Song[] }>("/songs")
      .then((r) => setLibrary(r.songs))
      .catch((err) => setError(err.message));
  }, []);

  const toggle = (id: number) => onChange(inList.has(id) ? inPlaylist.filter((x) => x !== id) : [...inPlaylist, id]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Add songs" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span className="section-title grow">Add songs</span>
          <button className="link-button" style={{ color: "var(--accent)" }} onClick={onClose}>
            Done
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {library && library.length > 0 && <SongFilterBar filter={filter} />}
        <div className="sheet-list">
          {library?.length === 0 && <p className="empty">The library is empty. Upload songs on the Music screen.</p>}
          {library && library.length > 0 && filter.shown.length === 0 && <p className="empty">No songs match.</p>}
          {filter.shown.map((s) => {
            const added = inList.has(s.id);
            return (
              <button key={s.id} className={`pick-row${added ? " on" : ""}`} aria-pressed={added} onClick={() => toggle(s.id)}>
                <span className={`select-box${added ? " on" : ""}`} aria-hidden>
                  {added && <CheckIcon />}
                </span>
                <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                  <span className="song-title truncate">{s.title}</span>
                  <span className="song-meta truncate">
                    {s.artist ? `${s.artist} · ` : ""}
                    {formatLength(s.durationMs)}
                    {s.tags.length ? <span className="song-tags">{s.tags.map((t) => ` #${t}`).join("")}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Switch to keep a playlist's songs on this phone, with the space it takes. */
function KeepOnPhone({ playlist }: { playlist: Playlist }) {
  const [keep, setKeep] = useState(() => keepsPlaylist(playlist.id));
  const [stored, setStored] = useState(0);
  const [progress, setProgress] = useState(() => songDownloadProgress(playlist.id));
  const [busy, setBusy] = useState(false);
  const total = playlist.songs.reduce((sum, s) => sum + s.sizeBytes, 0);

  useEffect(() => {
    let live = true;
    const update = async () => {
      const ids = await storedSongIds(playlist.songs);
      if (!live) return;
      setKeep(keepsPlaylist(playlist.id));
      setStored(ids.size);
      setProgress(songDownloadProgress(playlist.id));
    };
    void update();
    const stop = onPlaylistChange(() => void update());
    return () => {
      live = false;
      stop();
    };
  }, [playlist]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await setKeepPlaylist(playlist.id, !keep);
    } catch (err) {
      alert(`Couldn't keep the songs on this phone. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const ready = keep && stored === playlist.songs.length;
  return (
    <div className="card row">
      <span className="stack grow" style={{ gap: 2 }}>
        <span style={{ fontWeight: 800 }}>Keep on this phone</span>
        <span className="muted small">
          {progress
            ? `Downloading ${progress.done} of ${progress.total}…`
            : ready
              ? `All ${playlist.songs.length} songs saved · ${formatSize(total)}`
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
