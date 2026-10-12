import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { PageHead } from "../components/PageHead.tsx";
import { ChevronIcon } from "../components/Icons.tsx";
import { SortableList } from "../components/SortableList.tsx";
import { AnnouncerSettings } from "../components/AnnouncerSettings.tsx";
import type { AnnouncerStyle, Player, Roster } from "../../shared/types.ts";

export function RosterEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [template, setTemplate] = useState("");

  useEffect(() => {
    api<{ roster: Roster }>(`/rosters/${id}`)
      .then((r) => {
        setRoster(r.roster);
        setName(r.roster.name);
        setTemplate(r.roster.announceTemplate);
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

  async function saveOrder(players: Player[]) {
    if (!roster) return;
    const before = roster;
    setRoster({ ...roster, players });
    try {
      const r = await api<{ roster: Roster }>(`/rosters/${roster.id}/order`, {
        method: "PUT",
        body: { playerIds: players.map((p) => p.id) },
      });
      setRoster(r.roster);
    } catch (err) {
      setRoster(before);
      setError((err as Error).message);
    }
  }

  async function saveAnnouncer(changes: { announce?: boolean; announceTemplate?: string }) {
    if (!roster) return;
    try {
      const r = await api<{ roster: Roster }>(`/rosters/${roster.id}`, { method: "PATCH", body: changes });
      setRoster(r.roster);
      setTemplate(r.roster.announceTemplate);
    } catch (err) {
      setError((err as Error).message);
      setTemplate(roster.announceTemplate);
    }
  }

  /** Saves the team's announcer voice or delivery; its announcements are remade. */
  async function saveTeamAnnouncer(changes: { voice?: string; style?: AnnouncerStyle }): Promise<Roster | null> {
    if (!roster) return null;
    const r = await api<{ roster: Roster }>(`/rosters/${roster.id}/announcer`, { method: "PUT", body: changes });
    setRoster(r.roster);
    return r.roster;
  }

  async function deleteRoster() {
    if (!roster) return;
    if (!confirm(`Delete ${roster.name} and all its players? Songs stay in the library.`)) return;
    await api(`/rosters/${roster.id}`, { method: "DELETE" });
    navigate("/");
  }

  return (
    <>
      <PageHead back="/" eyebrow="Edit team" />
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

          <div className="card stack">
            <div className="row">
              <span className="section-title grow">Announcer</span>
              <button
                role="switch"
                aria-checked={roster.announce}
                className={`switch${roster.announce ? " on" : ""}`}
                onClick={() => void saveAnnouncer({ announce: !roster.announce })}
              >
                <span className="switch-label">{roster.announce ? "On" : "Off"}</span>
                <span className="switch-track">
                  <span className="switch-knob" />
                </span>
              </button>
            </div>
            {roster.announce && (
              <>
                <label>
                  What it says
                  <input
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    onBlur={() => template.trim() !== roster.announceTemplate && void saveAnnouncer({ announceTemplate: template })}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    maxLength={200}
                  />
                </label>
                <p className="muted small" style={{ margin: 0 }}>
                  {"{number}"} and {"{name}"} are filled in for each player. Players with no number skip the number.
                  With ElevenLabs you can direct parts of the line with cues in square brackets, e.g.{" "}
                  {"[drawn out] Now batting, [excited] number {number}, {name}!"}
                </p>
                <AnnouncerSettings
                  voice={roster.announcerVoice}
                  style={roster.announcerStyle}
                  template={roster.announceTemplate}
                  onVoice={async (voice) => {
                    await saveTeamAnnouncer({ voice });
                  }}
                  onStyle={async (style) => (await saveTeamAnnouncer({ style }))?.announcerStyle ?? style}
                />
              </>
            )}
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <span className="section-title grow">{sorting ? "Drag to set batting order" : "Players"}</span>
            {roster.players.length > 1 && (
              <button
                className="link-button"
                style={sorting ? { color: "var(--accent)" } : undefined}
                onClick={() => setSorting(!sorting)}
              >
                {sorting ? "Done" : "Reorder"}
              </button>
            )}
          </div>
          {roster.players.length === 0 && <p className="empty">No players yet.</p>}
          <SortableList items={roster.players} keyOf={(p) => p.id} sorting={sorting} onReorder={saveOrder}>
            {(p) => {
              const content = (
                <>
                  <span className="jersey">{p.number}</span>
                  <span className="stack grow" style={{ gap: 2 }}>
                    <span className="player-name truncate">{p.name}</span>
                    <span className="small truncate muted">{p.clip ? p.clip.song.title : "No song yet"}</span>
                  </span>
                </>
              );
              // While reordering, rows aren't links, so a missed grab can't open a player.
              return sorting ? (
                <div className="player-row">{content}</div>
              ) : (
                <Link to={`/players/${p.id}`}>
                  {content}
                  <span className="muted">
                    <ChevronIcon />
                  </span>
                </Link>
              );
            }}
          </SortableList>
          {!sorting && <AddPlayer rosterId={roster.id} onAdded={(p) => setRoster({ ...roster, players: [...roster.players, p] })} />}

          <button className="danger" style={{ marginTop: 24, alignSelf: "center" }} onClick={deleteRoster}>
            Delete team
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
