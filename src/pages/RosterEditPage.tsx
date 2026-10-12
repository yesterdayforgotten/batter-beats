import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { PageHead } from "../components/PageHead.tsx";
import { ChevronIcon } from "../components/Icons.tsx";
import type { Player, Roster } from "../../shared/types.ts";

export function RosterEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ roster: Roster }>(`/rosters/${id}`)
      .then((r) => {
        setRoster(r.roster);
        setName(r.roster.name);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  async function saveName() {
    if (!roster || name.trim() === roster.name) return;
    try {
      const r = await api<{ roster: Roster }>(`/rosters/${roster.id}`, { method: "PATCH", body: { name } });
      setRoster(r.roster);
      setName(r.roster.name);
    } catch (err) {
      setError((err as Error).message);
      setName(roster.name);
    }
  }

  async function deleteRoster() {
    if (!roster) return;
    if (!confirm(`Delete ${roster.name} and all its players? Songs stay in the library.`)) return;
    await api(`/rosters/${roster.id}`, { method: "DELETE" });
    navigate("/");
  }

  return (
    <>
      <PageHead back="/" eyebrow="Edit roster" />
      {error && <p className="error">{error}</p>}
      {roster && (
        <div className="stack" style={{ gap: 12 }}>
          <label>
            Team name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              maxLength={80}
            />
          </label>

          <div className="row" style={{ marginTop: 8 }}>
            <span className="section-title grow">Players</span>
            <span className="muted small">batting order is set in game mode</span>
          </div>
          {roster.players.length === 0 && <p className="empty">No players yet.</p>}
          <ul className="list">
            {roster.players.map((p) => (
              <li key={p.id} className="list-item">
                <Link to={`/players/${p.id}`}>
                  <span className="jersey">{p.number}</span>
                  <span className="stack grow" style={{ gap: 2 }}>
                    <span className="player-name truncate">{p.name}</span>
                    <span className="small truncate muted">{p.clip ? p.clip.song.title : "No song yet"}</span>
                  </span>
                  <span className="muted">
                    <ChevronIcon />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <AddPlayer rosterId={roster.id} onAdded={(p) => setRoster({ ...roster, players: [...roster.players, p] })} />

          <button className="danger" style={{ marginTop: 24, alignSelf: "center" }} onClick={deleteRoster}>
            Delete roster
          </button>
        </div>
      )}
    </>
  );
}

function AddPlayer({ rosterId, onAdded }: { rosterId: number; onAdded(p: Player): void }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const numberInput = useRef<HTMLInputElement>(null);

  // Stays open after each add so a whole team can be typed in one go; songs are chosen later in the player editor.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ player: Player }>(`/rosters/${rosterId}/players`, { body: { name, number } });
      onAdded(r.player);
      setNumber("");
      setName("");
      setError(null);
      numberInput.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) {
    return (
      <button className="add-button" onClick={() => setOpen(true)}>
        + Add player
      </button>
    );
  }
  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <div className="row">
        <input
          ref={numberInput}
          className="number-input"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="#"
          aria-label="Number"
          inputMode="numeric"
          maxLength={4}
          autoFocus
        />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" required maxLength={80} />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary">Add player</button>
        <button type="button" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </form>
  );
}
