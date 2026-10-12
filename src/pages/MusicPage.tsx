import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { CheckIcon, PlayIcon, StopIcon } from "../components/Icons.tsx";
import { PageHead } from "../components/PageHead.tsx";
import { SongFilterBar, useSongFilter } from "../components/SongFilter.tsx";
import { TagEditor } from "../components/TagEditor.tsx";
import { UploadSheet } from "../components/UploadSheet.tsx";
import { BulkTagSheet } from "../components/BulkTagSheet.tsx";
import { teamColor, type LibrarySong, type Song, type TagSuggestions } from "../../shared/types.ts";

const formatLength = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Where a song is used, in a few words: "Ava, Ben (Waves) · 2 playlists", each team in its colour. */
function Usage({ song }: { song: LibrarySong }) {
  const byTeam = new Map<number, { name: string; color: string; players: string[] }>();
  for (const p of song.players) {
    const t = byTeam.get(p.rosterId) ?? { name: p.rosterName, color: p.rosterColor, players: [] };
    t.players.push(p.name);
    byTeam.set(p.rosterId, t);
  }
  const parts = [...byTeam].map(([id, t]) => (
    <span key={id} style={{ color: teamColor(t.color).accent }}>
      {t.players.join(", ")} ({t.name})
    </span>
  ));
  if (song.playlists > 0) {
    parts.push(
      <span key="playlists" className="song-playlists">
        {song.playlists} {song.playlists === 1 ? "playlist" : "playlists"}
      </span>,
    );
  }
  if (parts.length === 0) return <span className="faint">Not used</span>;
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {part}
        </span>
      ))}
    </>
  );
}

/** The shared music library (editors): listen, fix titles, tag, upload and delete. */
export function MusicPage() {
  const [songs, setSongs] = useState<LibrarySong[] | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestions>({ teams: [], players: [], used: [] });
  const [error, setError] = useState<string | null>(null);
  const filter = useSongFilter(songs);
  const [openId, setOpenId] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  /** Files chosen for upload; the upload sheet is open while set. */
  const [picked, setPicked] = useState<File[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Select mode: tapping songs ticks them, for changing tags on many at once. */
  /** A–Z, or newest first (handy right after uploading). */
  const [sort, setSort] = useState<"az" | "new">("az");
  const sorted =
    sort === "az"
      ? filter.shown
      : [...filter.shown].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

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

  function toggleSelected(id: number) {
    setSelected((sel) => {
      const next = new Set(sel);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function applyBulk(add: string[], remove: string[]) {
    const r = await api<{ songs: Song[] }>("/songs/tags", { method: "POST", body: { songIds: [...selected], add, remove } });
    const byId = new Map(r.songs.map((x) => [x.id, x]));
    setSongs((list) => list?.map((x) => (byId.has(x.id) ? { ...x, tags: byId.get(x.id)!.tags } : x)) ?? null);
    setSuggestions((sg) => ({ ...sg, used: [...new Set([...sg.used, ...add])] }));
    // A tag just removed shouldn't keep filtering the list (it would now show nothing).
    filter.setTags((tags) => tags.filter((t) => !remove.some((r) => r.toLowerCase() === t.toLowerCase())));
    stopSelecting();
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

  return (
    <>
      <PageHead title={<div className="display" style={{ fontSize: 30 }}>Music</div>} />
      <p className="muted small" style={{ margin: "0 4px 14px" }}>
        Every song, shared by all teams. Tap one to edit, tag or delete it.
      </p>
      {error && (
        <p className="error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <button className="add-button" style={{ marginBottom: 8 }} onClick={() => fileInput.current?.click()}>
        + Upload MP3s
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/mpeg,.mp3"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = ""; // so choosing the same files again still opens the sheet
          if (files.length) setPicked(files);
        }}
      />
      {picked && (
        <UploadSheet
          files={picked}
          suggestions={suggestions}
          onUploaded={() => void load()}
          onClose={() => setPicked(null)}
        />
      )}
      {songs && songs.length > 0 && (
        <div style={{ margin: "6px 0 10px" }}>
          <SongFilterBar filter={filter} />
        </div>
      )}
      {songs && songs.length > 0 && (
        <div className="row select-bar">
          {selecting ? (
            <>
              <button
                className="link-button"
                onClick={() => setSelected(new Set([...selected, ...filter.shown.map((x) => x.id)]))}
                disabled={filter.shown.every((x) => selected.has(x.id))}
              >
                {filter.filtering ? `Select all ${filter.shown.length} shown` : `Select all ${songs.length}`}
              </button>
              {selected.size > 0 && (
                <button className="link-button" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
              <span className="grow" />
              <button className="link-button" style={{ color: "var(--accent)" }} onClick={stopSelecting}>
                Done
              </button>
            </>
          ) : (
            <>
              <span className="muted small grow">
                {filter.filtering ? `${filter.shown.length} of ${songs.length} songs` : `${songs.length} ${songs.length === 1 ? "song" : "songs"}`}
              </span>
              <button className="link-button" onClick={() => setSort(sort === "az" ? "new" : "az")} aria-label="Change sort order">
                {sort === "az" ? "A–Z" : "Newest"} ⇅
              </button>
              <button
                className="link-button"
                onClick={() => {
                  setOpenId(null);
                  setSelecting(true);
                }}
              >
                Select
              </button>
            </>
          )}
        </div>
      )}
      {songs?.length === 0 && <p className="empty">No songs yet.</p>}
      {songs && songs.length > 0 && filter.shown.length === 0 && <p className="empty">No songs match.</p>}

      <ul className="list song-list">
        {sorted.map((s) => {
          const open = openId === s.id;
          return (
            <li key={s.id} className={`list-item song-item${open ? " open" : ""}${selected.has(s.id) ? " selected" : ""}`}>
              <div className="player-row">
                {selecting ? (
                  <span className={`select-box${selected.has(s.id) ? " on" : ""}`} aria-hidden>
                    {selected.has(s.id) && <CheckIcon />}
                  </span>
                ) : (
                  <button
                    className={`song-play${playingId === s.id ? " on" : ""}`}
                    aria-label={playingId === s.id ? `Stop ${s.title}` : `Play ${s.title}`}
                    onClick={() => togglePlay(s)}
                  >
                    {playingId === s.id ? <StopIcon /> : <PlayIcon />}
                  </button>
                )}
                <button
                  className="song-summary grow"
                  aria-expanded={selecting ? undefined : open}
                  aria-pressed={selecting ? selected.has(s.id) : undefined}
                  onClick={() => (selecting ? toggleSelected(s.id) : setOpenId(open ? null : s.id))}
                >
                  <span className="song-title truncate">{s.title}</span>
                  <span className="song-meta truncate">
                    {s.artist ? `${s.artist} · ` : ""}
                    {formatLength(s.durationMs)}
                    {" · "}
                    <Usage song={s} />
                    {s.tags.length > 0 && <span className="song-tags">{s.tags.map((t) => ` #${t}`).join("")}</span>}
                  </span>
                </button>
              </div>
              {open && !selecting && (
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

      {selecting && (
        <div className="select-actions">
          <span className="grow" style={{ fontWeight: 700 }}>
            {selected.size === 0 ? "Tap songs to select them" : `${selected.size} selected`}
            {selected.size > 0 && [...selected].some((id) => !filter.shown.some((x) => x.id === id)) && (
              <span className="muted small"> (some hidden by the filter)</span>
            )}
          </span>
          <button className="primary" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}>
            Edit tags
          </button>
        </div>
      )}
      {bulkOpen && songs && (
        <BulkTagSheet
          songs={songs.filter((x) => selected.has(x.id))}
          suggestions={suggestions}
          onApply={applyBulk}
          onClose={() => setBulkOpen(false)}
        />
      )}
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
            <Link key={p.id} to={`/players/${p.id}`} className="small song-player-link" style={{ color: teamColor(p.rosterColor).accent }}>
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
