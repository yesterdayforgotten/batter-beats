import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { KebabIcon } from "../components/Icons.tsx";
import type { Roster, RosterSummary } from "../../shared/types.ts";

export function RostersPage() {
  const { user } = useAuth();
  const editor = hasRole(user, "editor");
  const [rosters, setRosters] = useState<RosterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ rosters: RosterSummary[] }>("/rosters")
      .then((r) => setRosters(r.rosters))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section>
      <h1 className="big-title">
        Pick
        <br />
        your team
      </h1>
      {error && <p className="error">{error}</p>}
      {rosters && rosters.length === 0 && (
        <p className="empty">{editor ? "No rosters yet. Add your first team below." : "No rosters yet."}</p>
      )}
      <ul className="list">
        {rosters?.map((r) => (
          <li key={r.id} className="list-item">
            <Link to={`/rosters/${r.id}`}>
              <span className="stack grow" style={{ gap: 4 }}>
                <span className="roster-name truncate">{r.name}</span>
                <span className="muted small">
                  {r.playerCount} {r.playerCount === 1 ? "player" : "players"}
                </span>
              </span>
            </Link>
            {editor && (
              <Link to={`/rosters/${r.id}/edit`} aria-label={`Edit ${r.name}`} className="kebab">
                <KebabIcon />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {editor && <NewRoster />}
    </section>
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
      navigate(`/rosters/${r.roster.id}/edit`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="add-button" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        + New roster
      </button>
    );
  }
  return (
    <form className="card stack" style={{ marginTop: 10 }} onSubmit={handleSubmit}>
      <label>
        Team name
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} />
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
