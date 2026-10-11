import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { PageHead } from "../components/PageHead.tsx";
import type { Roster } from "../../shared/types.ts";

/** Game mode lives here from phase 3. For now it shows the lineup. */
export function RosterPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ roster: Roster }>(`/rosters/${id}`)
      .then((r) => setRoster(r.roster))
      .catch((err) => setError(err.message));
  }, [id]);

  return (
    <>
      <PageHead
        back="/"
        title={<div className="display truncate" style={{ fontSize: 30 }}>{roster?.name ?? ""}</div>}
        right={
          hasRole(user, "editor") && roster ? (
            <Link to={`/rosters/${roster.id}/edit`}>
              <button>Edit</button>
            </Link>
          ) : null
        }
      />
      {error && <p className="error">{error}</p>}
      <p className="muted small" style={{ margin: "4px 4px 12px" }}>
        Game mode (tap to play) arrives in the next phase.
      </p>
      <ul className="list">
        {roster?.players.map((p) => (
          <li key={p.id} className="list-item" style={{ padding: "12px 14px", minHeight: 64 }}>
            <span className="jersey">{p.number}</span>
            <span className="stack grow" style={{ gap: 2 }}>
              <span className="player-name truncate">{p.name}</span>
              <span className="muted small truncate">{p.clip ? p.clip.song.title : "No song yet"}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
