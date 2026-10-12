import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, isNetworkError } from "../api.ts";
import { cameFromTeams } from "../editReturn.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { CheckIcon, KebabIcon } from "../components/Icons.tsx";
import {
  clipProgress,
  downloadProgress,
  forgetOffline,
  isKept,
  keepOffline,
  onOfflineChange,
  savedRoster,
  savedRosters,
} from "../offline.ts";
import { teamColor, type Roster, type RosterSummary } from "../../shared/types.ts";

export function RostersPage() {
  const { user } = useAuth();
  const editor = hasRole(user, "editor");
  const [rosters, setRosters] = useState<RosterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api<{ rosters: RosterSummary[] }>("/rosters", { timeoutMs: 6000 })
      .then((r) => setRosters(r.rosters))
      .catch((err) => {
        if (!isNetworkError(err)) return setError(err.message);
        // No connection: show the teams saved on this phone.
        setOffline(true);
        setRosters(
          savedRosters().map((r) => ({ id: r.id, name: r.name, color: r.color, playerCount: r.players.length, updatedAt: r.updatedAt })),
        );
      });
  }, []);

  return (
    <section>
      <h1 className="big-title">Teams</h1>
      {error && <p className="error">{error}</p>}
      {offline && (
        <p className="notice">
          No connection. {rosters?.length ? "Showing the teams saved on this phone." : "No teams are saved on this phone yet."}
        </p>
      )}
      {!offline && rosters && rosters.length === 0 && (
        <p className="empty">{editor ? "No teams yet. Add your first team below." : "No teams yet."}</p>
      )}
      <ul className="list">
        {rosters?.map((r) => (
          <li key={r.id} className="list-item">
            <Link to={`/rosters/${r.id}`}>
              <span className="team-dot" style={{ background: teamColor(r.color).accent }} aria-hidden />
              <span className="stack grow" style={{ gap: 4 }}>
                <span className="roster-name truncate">{r.name}</span>
                <span className="muted small">
                  {r.playerCount} {r.playerCount === 1 ? "player" : "players"}
                </span>
              </span>
            </Link>
            {!offline && <OfflineSwitch id={r.id} name={r.name} />}
            {editor && !offline && (
              <Link to={`/rosters/${r.id}/edit`} onClick={cameFromTeams} aria-label={`Edit ${r.name}`} className="kebab">
                <KebabIcon />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {editor && !offline && <NewRoster />}
    </section>
  );
}

/** "Keep on this phone" switch, with progress while downloading and a tick when everything is there. */
function OfflineSwitch({ id, name }: { id: number; name: string }) {
  const [kept, setKept] = useState(() => isKept(id));
  const [label, setLabel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const update = async () => {
      const k = isKept(id);
      const roster = savedRoster(id);
      const downloading = downloadProgress(id);
      if (!live) return;
      setKept(k);
      if (!k || !roster) {
        setReady(false);
        setLabel(null);
      } else if (downloading) {
        setReady(false);
        setLabel(`${downloading.done}/${downloading.total}`);
      } else {
        const p = await clipProgress(roster);
        if (!live) return;
        setReady(p.done === p.total);
        setLabel(p.done === p.total ? null : `${p.done}/${p.total}`);
      }
    };
    void update();
    const stop = onOfflineChange(() => void update());
    return () => {
      live = false;
      stop();
    };
  }, [id]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (kept) {
        if (confirm(`Remove ${name} from this phone? It can still be used with a connection.`)) await forgetOffline(id);
      } else {
        await keepOffline(id);
      }
    } catch (err) {
      alert(`Couldn't save ${name} on this phone. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      role="switch"
      aria-checked={kept}
      aria-label={`Keep ${name} on this phone for offline use`}
      className={`switch offline-switch${kept ? " on" : ""}`}
      onClick={toggle}
    >
      <span className="switch-label">
        {ready ? (
          <>
            <CheckIcon /> Offline
          </>
        ) : (
          (label ?? "Offline")
        )}
      </span>
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

function NewRoster() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ roster: Roster }>("/rosters", { body: { name } });
      cameFromTeams();
      navigate(`/rosters/${r.roster.id}/edit`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="add-button" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        + New team
      </button>
    );
  }
  return (
    <form className="card stack" style={{ marginTop: 10 }} onSubmit={handleSubmit}>
      <label>
        Team name
        <input className="input-large" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary">Create</button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
