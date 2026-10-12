import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api, upload } from "../api.ts";
import { PlayIcon, StopIcon } from "../components/Icons.tsx";
import { PageHead } from "../components/PageHead.tsx";
import { SongFilterBar, useSongFilter } from "../components/SongFilter.tsx";
import { TagEditor } from "../components/TagEditor.tsx";
import type { LibrarySong, Song, TagSuggestions } from "../../shared/types.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Where a song is used, in a few words: "Ava, Ben (Waves) · 2 playlists". */
function usage(s: LibrarySong): string {
  const byTeam = new Map<string, string[]>();
  for (const p of s.players) byTeam.set(p.rosterName, [...(byTeam.get(p.rosterName) ?? []), p.name]);
  const parts = [...byTeam].map(([team, names]) => `${names.join(", ")} (${team})`);
  if (s.playlists > 0) parts.push(`${s.playlists} ${s.playlists === 1 ? "playlist" : "playlists"}`);
  return parts.length ? parts.join(" · ") : "Not used";
}

/** The shared music library (editors): listen, fix titles, tag, upload and delete. */
export function MusicPage() {
  const [songs, setSongs] = useState<LibrarySong[] | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestions>({ teams: [], players: [], used: [] });
  const [error, setError] = useState<string | null>(null);
  const filter = useSongFilter(songs);
  const [openId, setOpenId] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = () =>
    api<{ songs: LibrarySong[]; suggestions: TagSuggestions }>("/songs/library")
      .then((r) => {
        setSongs(r.songs);
        setSuggestions(r.suggestions);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    void load();
    return () => audio.current?.pause();
  }, []);

  function togglePlay(s: LibrarySong) {
    audio.current?.pause();
    if (playingId === s.id) return setPlayingId(null);
    const a = new Audio(s.url);
    a.onended = () => setPlayingId((id) => (id === s.id ? null : id));
    a.play().catch((err) => {
      setPlayingId(null);
      setError(`Couldn't play it. ${(err as Error).message}`);
    });
    audio.current = a;
    setPlayingId(s.id);
  }

  async function rename(s: LibrarySong, changes: { title?: string; artist?: string }) {
    const title = changes.title?.trim() ?? s.title;
    const artist = changes.artist?.trim() ?? s.artist;
    if (title === s.title && artist === s.artist) return;
    try {
      const r = await api<{ song: Song }>(`/songs/${s.id}`, { method: "PATCH", body: { title, artist } });
      setSongs((list) => list?.map((x) => (x.id === s.id ? { ...x, ...r.song } : x)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveTags(s: LibrarySong, tags: string[]) {
    setSongs((list) => list?.map((x) => (x.id === s.id ? { ...x, tags } : x)) ?? null);
    try {
      const r = await api<{ song: Song }>(`/songs/${s.id}/tags`, { method: "PUT", body: { tags } });
      setSongs((list) => list?.map((x) => (x.id === s.id ? { ...x, tags: r.song.tags } : x)) ?? null);
      setSuggestions((sg) => ({ ...sg, used: [...new Set([...sg.used, ...r.song.tags])] }));
    } catch (err) {
      setSongs((list) => list?.map((x) => (x.id === s.id ? { ...x, tags: s.tags } : x)) ?? null);
      setError((err as Error).message);
    }
  }

  async function remove(s: LibrarySong) {
    const where = s.playlists > 0 ? ` It will also leave ${s.playlists} ${s.playlists === 1 ? "playlist" : "playlists"}.` : "";
    if (!confirm(`Delete "${s.title}" from the library?${where} This can't be undone.`)) return;
    try {
      await api(`/songs/${s.id}`, { method: "DELETE" });
      if (playingId === s.id) audio.current?.pause();
      setSongs((list) => list?.filter((x) => x.id !== s.id) ?? null);
      setOpenId(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(0);
    try {
      const r = await upload<{ song: Song }>("/songs", file, setUploading);
      await load();
      setOpenId(r.song.id); // open it, so a wrong title can be fixed straight away
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <>
      <PageHead back="/" title={<div className="display" style={{ fontSize: 30 }}>Music</div>} />
      <p className="muted small" style={{ margin: "0 4px 14px" }}>
        Every uploaded song, shared by all teams and playlists. Tap a song to fix its title, tag it (a team, a player…) or delete it.
      </p>
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <button className="add-button" style={{ marginBottom: 8 }} disabled={uploading !== null} onClick={() => fileInput.current?.click()}>
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
      {songs && songs.length > 0 && (
        <div style={{ margin: "6px 0 10px" }}>
          <SongFilterBar filter={filter} />
        </div>
      )}
      {songs?.length === 0 && <p className="empty">No songs yet.</p>}
      {songs && songs.length > 0 && filter.shown.length === 0 && <p className="empty">No songs match.</p>}

      <ul className="list song-list">
        {filter.shown.map((s) => {
          const open = openId === s.id;
          return (
            <li key={s.id} className={`list-item song-item${open ? " open" : ""}`}>
              <div className="player-row">
                <button
                  className={`song-play${playingId === s.id ? " on" : ""}`}
                  aria-label={playingId === s.id ? `Stop ${s.title}` : `Play ${s.title}`}
                  onClick={() => togglePlay(s)}
                >
                  {playingId === s.id ? <StopIcon /> : <PlayIcon />}
                </button>
                <button className="song-summary grow" aria-expanded={open} onClick={() => setOpenId(open ? null : s.id)}>
                  <span className="song-title truncate">{s.title}</span>
                  <span className="song-meta truncate">
                    {s.artist ? `${s.artist} · ` : ""}
                    {formatLength(s.durationMs)}
                    {" · "}
                    <span className={s.players.length || s.playlists ? "song-usage" : "faint"}>{usage(s)}</span>
                    {s.tags.length > 0 && <span className="song-tags">{s.tags.map((t) => ` #${t}`).join("")}</span>}
                  </span>
                </button>
              </div>
              {open && (
                <SongDetails
                  song={s}
                  suggestions={suggestions}
                  onRename={(c) => rename(s, c)}
                  onTags={(t) => saveTags(s, t)}
                  onDelete={() => remove(s)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SongDetails({
  song,
  suggestions,
  onRename,
  onTags,
  onDelete,
}: {
  song: LibrarySong;
  suggestions: TagSuggestions;
  onRename(changes: { title?: string; artist?: string }): void;
  onTags(tags: string[]): void;
  onDelete(): void;
}) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist);
  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();
  const added = new Date(song.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="song-details stack">
      <label>
        Title
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={() => (title.trim() ? onRename({ title }) : setTitle(song.title))} onKeyDown={blurOnEnter} />
      </label>
      <label>
        Artist
        <input value={artist} maxLength={200} onChange={(e) => setArtist(e.target.value)} onBlur={() => onRename({ artist })} onKeyDown={blurOnEnter} />
      </label>
      <TagEditor tags={song.tags} suggestions={suggestions} onChange={onTags} />
      {song.players.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="field-label">Walkup song for</span>
          {song.players.map((p) => (
            <Link key={p.id} to={`/players/${p.id}`} className="small song-player-link">
              {p.number ? `#${p.number} ` : ""}
              {p.name} · {p.rosterName}
            </Link>
          ))}
        </div>
      )}
      <p className="faint small" style={{ margin: 0 }}>
        Added {added}
        {song.uploadedBy ? ` by ${song.uploadedBy}` : ""}
      </p>
      {song.players.length > 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          To delete this song, pick a different song for {song.players.length === 1 ? "that player" : "those players"} first.
        </p>
      ) : (
        <button className="danger" style={{ alignSelf: "flex-start" }} onClick={onDelete}>
          Delete song
        </button>
      )}
    </div>
  );
}
