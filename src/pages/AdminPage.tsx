import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, upload } from "../api.ts";
import { context, Playback, unlockAudio } from "../audio/engine.ts";
import { CheckIcon, ChevronIcon } from "../components/Icons.tsx";

interface AnnouncerInfo {
  voice: string;
  voices: string[];
  error: string | null;
}

// Kokoro voice ids look like "am_michael": language/accent, then female/male, then a name.
const ACCENTS: Record<string, string> = { a: "American", b: "British" };

function describe(id: string): { name: string; detail: string } | null {
  const m = /^([a-z])([fm])_(.+)$/.exec(id);
  if (!m || !ACCENTS[m[1]]) return null; // only English voices: announcements are in English
  if (m[3].startsWith("v0")) return null; // older copies of voices that are also listed under their plain name
  const name = m[3].replace(/_inno$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, detail: `${ACCENTS[m[1]]} · ${m[2] === "m" ? "male" : "female"}` };
}

/** Admin: users, the announcer's voice, and backups. */
export function AdminPage() {
  return (
    <section>
      <h1 className="big-title">Admin</h1>
      <ul className="list">
        <li className="list-item">
          <Link to="/admin/users">
            <span className="stack grow" style={{ gap: 2 }}>
              <span className="player-name">Users</span>
              <span className="muted small">Add people, set roles, reset passwords</span>
            </span>
            <span className="muted">
              <ChevronIcon />
            </span>
          </Link>
        </li>
      </ul>
      <AnnouncerVoice />
      <Backup />
    </section>
  );
}

function AnnouncerVoice() {
  const [info, setInfo] = useState<AnnouncerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const current = useRef<Playback | null>(null);

  useEffect(() => {
    api<AnnouncerInfo>("/announcer")
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

  async function listen(voice: string) {
    unlockAudio(); // must start inside the tap
    current.current?.stop();
    setPlaying(voice);
    setError(null);
    try {
      const res = await fetch("/api/announcer/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The sample didn't play.");
      const buffer = await context().decodeAudioData(await res.arrayBuffer());
      const p = new Playback(null, null, { buffer, songDelayMs: 0 });
      current.current = p;
      p.onEnded = () => setPlaying((v) => (v === voice ? null : v));
    } catch (err) {
      setError((err as Error).message);
      setPlaying(null);
    }
  }

  async function choose(voice: string) {
    try {
      await api("/announcer/voice", { method: "PUT", body: { voice } });
      setInfo((i) => i && { ...i, voice });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const voices = (info?.voices ?? [])
    .map((id) => ({ id, d: describe(id) }))
    .filter((v): v is { id: string; d: { name: string; detail: string } } => !!v.d)
    .sort((a, b) => a.d.detail.localeCompare(b.d.detail) || a.d.name.localeCompare(b.d.name));
  // Male voices first, since they suit a stadium announcer; the rest on request.
  const shown = showAll ? voices : voices.filter((v) => v.id[1] === "m" || v.id === info?.voice);

  return (
    <>
      <div className="section-title" style={{ margin: "26px 4px 8px" }}>
        Announcer voice
      </div>
      <p className="muted small" style={{ margin: "0 4px 10px" }}>
        Listen to "Now batting, number 12, Alex Rivera" in each voice. Choosing a voice remakes every announcement; that
        takes a little while for a big roster.
      </p>
      {(error || info?.error) && <p className="error">{error ?? info?.error}</p>}
      {!info && !error && <p className="muted">Loading…</p>}
      <ul className="list">
        {shown.map(({ id, d }) => (
          <li key={id} className="list-item">
            <div className="player-row">
              <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="player-name truncate">
                  {d.name} {id === info?.voice && <span className="tag on-deck-tag">In use</span>}
                </span>
                <span className="muted small">{d.detail}</span>
              </span>
              <button className="small-button" onClick={() => listen(id)} disabled={playing === id}>
                {playing === id ? "…" : "Listen"}
              </button>
              {id !== info?.voice && (
                <button className="small-button primary" onClick={() => choose(id)}>
                  Use
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {voices.length > shown.length && (
        <button className="link-button" style={{ marginTop: 6 }} onClick={() => setShowAll(true)}>
          Show all {voices.length} English voices
        </button>
      )}
    </>
  );
}

function Backup() {
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function restore(file: File | undefined) {
    if (!file) return;
    if (fileInput.current) fileInput.current.value = "";
    if (
      !confirm(
        `Replace everything (teams, players, songs, users, playlists) with the backup in "${file.name}"? Everything here now is replaced.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setProgress(0);
    try {
      await upload("/admin/restore", file, setProgress);
      setMessage("Restored. Reloading…");
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <div className="section-title" style={{ margin: "26px 4px 8px" }}>
        Backup
      </div>
      <div className="card stack">
        <p className="muted small" style={{ margin: 0 }}>
          One file with everything: teams, players, songs, clips, announcements, users and playlists. Keep it somewhere
          safe, off this server.
        </p>
        <a className="button-link primary" href="/api/admin/backup" download>
          Download backup
        </a>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Restoring replaces everything with what's in a backup file. People may need to sign in again afterwards.
        </p>
        <button disabled={progress !== null} onClick={() => fileInput.current?.click()}>
          {progress === null
            ? "Restore from a backup…"
            : progress < 1
              ? `Uploading… ${Math.round(progress * 100)}%`
              : "Restoring…"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".tar,application/x-tar"
          style={{ display: "none" }}
          onChange={(e) => restore(e.target.files?.[0])}
        />
        {message && (
          <p className="muted" style={{ margin: 0 }}>
            <CheckIcon /> {message}
          </p>
        )}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </div>
    </>
  );
}
