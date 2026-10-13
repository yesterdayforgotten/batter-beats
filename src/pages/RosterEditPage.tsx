import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { PageHead } from "../components/PageHead.tsx";
import { ChevronIcon } from "../components/Icons.tsx";
import { SortableList } from "../components/SortableList.tsx";
import { editBack } from "../editReturn.ts";
import { AnnouncerSettings } from "../components/AnnouncerSettings.tsx";
import { TEAM_COLORS, teamColor, type AnnouncerStyle, type Player, type Roster } from "../../shared/types.ts";
import { teamStyle } from "../teamColors.ts";
import { CheckIcon } from "../components/Icons.tsx";

export function RosterEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  /** The Announcer section starts closed; its header opens it. */
  const [announcerOpen, setAnnouncerOpen] = useState(false);
  const [template, setTemplate] = useState("");
  /** A player just deleted (from their page), offered back with Undo. */
  const location = useLocation();
  const [deleted, setDeleted] = useState<{ id: number; name: string } | null>(
    () => (location.state as { deleted?: { id: number; name: string } } | null)?.deleted ?? null,
  );

  async function undoDelete() {
    if (!deleted) return;
    try {
      const r = await api<{ player: Player }>(`/players/${deleted.id}/restore`, { body: {} });
      setRoster((cur) =>
        cur ? { ...cur, players: [...cur.players, r.player].sort((a, b) => a.lineupPosition - b.lineupPosition || a.id - b.id) } : cur,
      );
    } catch (err) {
      setError((err as Error).message);
    }
    setDeleted(null);
    navigate(location.pathname, { replace: true, state: null }); // a reload shouldn't offer it again
  }

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

  /** Counts colour taps, so only the latest one's reply (or failure) is applied. */
  const colorSeq = useRef(0);
  /** The colour the server last confirmed, to go back to if a change fails. */
  const savedColor = useRef<string | null>(null);

  /** Changes the team colour at once (put back if the server refuses). */
  async function saveColor(color: string) {
    if (!roster || color === roster.color) return;
    savedColor.current ??= roster.color;
    const seq = ++colorSeq.current;
    setRoster((r) => (r ? { ...r, color } : r));
    try {
      const r = await api<{ roster: Roster }>(`/rosters/${roster.id}`, { method: "PATCH", body: { color } });
      savedColor.current = r.roster.color;
      if (seq === colorSeq.current) setRoster((cur) => (cur ? { ...cur, color: r.roster.color } : cur));
    } catch (err) {
      setError((err as Error).message);
      if (seq === colorSeq.current) setRoster((cur) => (cur ? { ...cur, color: savedColor.current ?? cur.color } : cur));
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
  async function saveTeamAnnouncer(changes: {
    voice?: string;
    style?: AnnouncerStyle;
    announceTemplate?: string;
  }): Promise<Roster | null> {
    if (!roster) return null;
    const r = await api<{ roster: Roster }>(`/rosters/${roster.id}/announcer`, { method: "PUT", body: changes });
    setRoster(r.roster);
    return r.roster;
  }

  async function deleteRoster() {
    if (!roster) return;
    if (!confirm(`Delete ${roster.name} and all its players? Songs stay in the library.`)) return;
    try {
      await api(`/rosters/${roster.id}`, { method: "DELETE" });
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div style={teamStyle(roster?.color)}>
      <PageHead
        done={editBack(id)}
        eyebrow="Edit team"
        title={
          roster ? (
            // The team name opens the team's game mode.
            <Link to={`/rosters/${roster.id}`} className="display truncate head-title-link" style={{ fontSize: 30 }}>
              {roster.name}
            </Link>
          ) : undefined
        }
      />
      {error && <p className="error" role="alert">{error}</p>}
      {deleted && (
        <div className="notice undo-bar" role="status">
          <span className="grow">Deleted {deleted.name}.</span>
          <button className="link-button" onClick={undoDelete}>
            Undo
          </button>
        </div>
      )}
      {roster && (
        <div className="stack" style={{ gap: 12 }}>
          <label>
            Team name
            <input
              className="input-large"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              maxLength={80}
            />
          </label>

          <div className="stack" style={{ gap: 8 }}>
            <div className="row">
              <span className="field-label grow">Team color</span>
              <span className="small muted">{teamColor(roster.color).name}</span>
            </div>
            <div className="swatches" role="radiogroup" aria-label="Team color">
              {TEAM_COLORS.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={roster.color === c.id}
                  aria-label={c.name}
                  title={c.name}
                  className="swatch"
                  style={{ background: c.accent, color: c.ink }}
                  onClick={() => void saveColor(c.id)}
                >
                  {roster.color === c.id && <CheckIcon />}
                </button>
              ))}
            </div>
          </div>

          <div className="card stack">
            <div className="row">
              <button
                className="section-toggle grow"
                aria-expanded={announcerOpen}
                onClick={() => setAnnouncerOpen((o) => !o)}
              >
                <span className={`toggle-chevron${announcerOpen ? " open" : ""}`} aria-hidden>
                  <ChevronIcon />
                </span>
                <span className="section-title">Announcer</span>
              </button>
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
            {!announcerOpen && roster.announce && (
              <button className="section-summary truncate" onClick={() => setAnnouncerOpen(true)}>
                {template || roster.announceTemplate}
              </button>
            )}
            {announcerOpen && roster.announce && (
              <>
                <label>
                  What it says
                  <input
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    maxLength={200}
                  />
                </label>
                {template.trim() !== roster.announceTemplate && (
                  <p className="small" style={{ margin: 0, color: "var(--accent)" }}>
                    Not saved yet: Listen below says it as typed; tap Use these settings to keep it.
                  </p>
                )}
                <p className="muted small" style={{ margin: 0 }}>
                  {"{number}"} and {"{name}"} are filled in for each player. Players with no number skip the number.
                  With ElevenLabs you can direct parts of the line with cues in square brackets, e.g.{" "}
                  {"[drawn out] Now batting, [excited] number {number}, {name}!"}
                </p>
                <AnnouncerSettings
                  voice={roster.announcerVoice}
                  style={roster.announcerStyle}
                  template={template}
                  savedTemplate={roster.announceTemplate}
                  onVoice={async (voice) => {
                    await saveTeamAnnouncer({ voice });
                  }}
                  onSave={async ({ style, template: wording }) => {
                    const r = await saveTeamAnnouncer({ style, announceTemplate: wording });
                    if (r) setTemplate(r.announceTemplate);
                    return r?.announcerStyle ?? style ?? roster.announcerStyle;
                  }}
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
          <SortableList items={roster.players} keyOf={(p) => p.id} sorting={sorting} compact onReorder={saveOrder}>
            {(p) => {
              const content = (
                <>
                  <span className="jersey">{p.number}</span>
                  <span className="stack grow" style={{ gap: 2 }}>
                    <span className="player-name truncate">{p.name}</span>
                    <span className="small truncate muted">{p.clip ? p.clip.song.title : "No song"}</span>
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
          {!sorting && <AddPlayer rosterId={roster.id} onAdded={(p) => setRoster((r) => (r ? { ...r, players: [...r.players, p] } : r))} />}

          <button className="danger" style={{ marginTop: 24, alignSelf: "center" }} onClick={deleteRoster}>
            Delete team
          </button>
        </div>
      )}
    </div>
  );
}

function AddPlayer({ rosterId, onAdded }: { rosterId: number; onAdded(p: Player): void }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const numberInput = useRef<HTMLInputElement>(null);

  // Stays open after each add so a whole team can be typed in one go; songs are chosen later in the player editor.
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return; // a double tap (or Enter twice) mustn't add the player twice
    setBusy(true);
    try {
      const r = await api<{ player: Player }>(`/rosters/${rosterId}/players`, { body: { name, number } });
      onAdded(r.player);
      setNumber("");
      setName("");
      setError(null);
      numberInput.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>
          {busy ? "Adding…" : "Add player"}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </form>
  );
}
