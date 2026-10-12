import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, upload } from "../api.ts";
import { CheckIcon, ChevronIcon } from "../components/Icons.tsx";
import { PageHead } from "../components/PageHead.tsx";
import type { VoiceEngine } from "../../shared/types.ts";
import type { AnnouncerEngineInfo } from "../components/AnnouncerSettings.tsx";

export function AdminPage() {
  return (
    <section>
      <PageHead back="/" title={<div className="display" style={{ fontSize: 30 }}>Admin</div>} />
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
      <AnnouncerEngine />
      <Backup />
    </section>
  );
}

/**
 * The announcer engine for the whole app (ElevenLabs or Kokoro), when both are
 * set up on the server. Each team picks its voice and delivery in Edit team.
 */
function AnnouncerEngine() {
  const [info, setInfo] = useState<AnnouncerEngineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<AnnouncerEngineInfo>("/announcer")
      .then(setInfo)
      .catch((err) => setError(err.message));

  useEffect(() => {
    void load();
  }, []);

  async function switchEngine(id: VoiceEngine) {
    if (id === info?.engine) return;
    setError(null);
    try {
      await api("/announcer/engine", { method: "PUT", body: { engine: id } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Only worth a section when there's a choice to make (or a problem to show).
  if (!(info && info.engines.length > 1) && !error && !info?.error) return null;
  return (
    <>
      <div className="section-title" style={{ margin: "26px 4px 8px" }}>
        Announcer
      </div>
      <p className="muted small" style={{ margin: "0 4px 10px" }}>
        Which voice service every team's announcements come from. Each team chooses its voice, delivery and wording in Edit team.
      </p>
      {info && info.engines.length > 1 && (
        <div className="segmented" role="radiogroup" aria-label="Voice engine" style={{ marginBottom: 10 }}>
          {info.engines.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={info.engine === e.id}
              className={info.engine === e.id ? "on" : ""}
              onClick={() => switchEngine(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
      {(error || info?.error) && <p className="error">{error ?? info?.error}</p>}
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
