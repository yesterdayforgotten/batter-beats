import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { fetchClip, loadClip, Playback, unlockAudio } from "../audio/engine.ts";
import { KebabIcon, PlayIcon, SoundBars, StopIcon } from "../components/Icons.tsx";
import { PageHead } from "../components/PageHead.tsx";
import { SortableList } from "../components/SortableList.tsx";
import { allowSleep, keepAwake } from "../wakeLock.ts";
import type { Player, Roster } from "../../shared/types.ts";

/** How quickly a playing song gets out of the way when a different batter is tapped. */
const SWITCH_FADE_SEC = 0.5;

const atBatKey = (rosterId: string | undefined) => `bb.atBat.${rosterId}`;

function readAtBat(rosterId: string | undefined): number | null {
  try {
    const v = localStorage.getItem(atBatKey(rosterId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function saveAtBat(rosterId: string | undefined, playerId: number) {
  try {
    localStorage.setItem(atBatKey(rosterId), String(playerId));
  } catch {
    // Storage blocked; the batter just isn't remembered after a reload.
  }
}

/** The next available batter after `atBatId` in batting order, wrapping round to the top. */
function nextBatter(order: Player[], atBatId: number | null): Player | null {
  const available = order.filter((p) => p.available);
  if (available.length === 0) return null;
  const from = order.findIndex((p) => p.id === atBatId);
  if (from === -1) return available[0];
  for (let i = 1; i <= order.length; i++) {
    const p = order[(from + i) % order.length];
    if (p.available && p.id !== atBatId) return p;
  }
  return null;
}

/** Game mode: the lineup as big buttons. Tap a batter to play their walkup; tap again to fade it out. */
export function GamePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [atBatId, setAtBatId] = useState<number | null>(() => readAtBat(id));
  const [sound, setSound] = useState<{ playerId: number; state: "loading" | "playing" | "fading" } | null>(null);
  const playback = useRef<Playback | null>(null);
  const tapCount = useRef(0);

  useEffect(() => {
    api<{ roster: Roster }>(`/rosters/${id}`)
      .then((r) => {
        setRoster(r.roster);
        // Download every clip now so taps don't wait on the network.
        for (const p of r.roster.players) if (p.clip?.url) void fetchClip(p.clip.url).catch(() => {});
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // Leaving game mode: stop the music and let the screen sleep.
  useEffect(
    () => () => {
      playback.current?.stop();
      allowSleep();
    },
    [],
  );

  const order = roster?.players ?? [];
  const lineup = order.filter((p) => p.available);
  const bench = order.filter((p) => !p.available);
  const onDeck = useMemo(() => nextBatter(order, atBatId), [order, atBatId]);

  // Have the on-deck batter's song decoded and ready before anyone taps.
  useEffect(() => {
    if (onDeck?.clip?.url) void loadClip(onDeck.clip.url).catch(() => {});
  }, [onDeck?.clip?.url]);

  async function tap(player: Player) {
    unlockAudio(); // both of these must start inside the tap
    keepAwake();
    const current = playback.current;

    // Tapping the batter whose song is playing fades it out.
    if (player.id === sound?.playerId && current?.playing) {
      if (!current.fading) {
        current.fadeOut();
        setSound({ playerId: player.id, state: "fading" });
      }
      return;
    }

    current?.fadeOut(SWITCH_FADE_SEC);
    playback.current = null;
    const tapId = ++tapCount.current;
    setAtBatId(player.id);
    saveAtBat(id, player.id);
    if (!player.clip?.url) {
      setSound(null);
      return;
    }
    setSound({ playerId: player.id, state: "loading" });
    try {
      const buffer = await loadClip(player.clip.url);
      if (tapId !== tapCount.current) return; // another batter was tapped meanwhile
      const p = new Playback(buffer, player.clip);
      playback.current = p;
      setSound({ playerId: player.id, state: "playing" });
      p.onEnded = () => {
        if (playback.current === p) {
          playback.current = null;
          setSound(null);
        }
      };
    } catch (err) {
      if (tapId === tapCount.current) {
        setSound(null);
        setError(`${player.name}'s song didn't load. ${(err as Error).message}`);
      }
    }
  }

  async function saveOrder(newLineup: Player[]) {
    if (!roster) return;
    const players = [...newLineup, ...bench];
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

  async function setAvailable(player: Player, available: boolean) {
    if (!roster) return;
    const before = roster;
    setRoster({ ...roster, players: roster.players.map((p) => (p.id === player.id ? { ...p, available } : p)) });
    try {
      await api(`/players/${player.id}/available`, { method: "PUT", body: { available } });
    } catch (err) {
      setRoster(before);
      setError((err as Error).message);
    }
  }

  function status(p: Player) {
    if (sound?.playerId === p.id) {
      if (sound.state === "loading") return <span className="bat-status">Loading…</span>;
      if (sound.state === "fading") return <span className="bat-status">Fading out</span>;
      return (
        <span className="bat-status">
          <SoundBars /> At bat · tap to fade
        </span>
      );
    }
    if (p.id === atBatId) return <span className="bat-status">At bat{p.clip ? " · tap to play again" : ""}</span>;
    if (!p.clip) return <span className="bat-status muted">No song</span>;
    return null;
  }

  return (
    <>
      <PageHead
        back="/"
        eyebrow={editing ? "Edit lineup" : "Game mode"}
        title={<div className="display truncate" style={{ fontSize: 30 }}>{roster?.name ?? ""}</div>}
        right={
          <div className="row" style={{ gap: 2 }}>
            <button
              role="switch"
              aria-checked={editing}
              className={`switch${editing ? " on" : ""}`}
              onClick={() => setEditing(!editing)}
            >
              <span className="switch-label">Edit lineup</span>
              <span className="switch-track">
                <span className="switch-knob" />
              </span>
            </button>
            {hasRole(user, "editor") && roster && (
              <Link to={`/rosters/${roster.id}/edit`} aria-label="Edit team" className="kebab">
                <KebabIcon />
              </Link>
            )}
          </div>
        }
      />
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {roster && order.length === 0 && <p className="empty">No players on this roster yet.</p>}

      {editing ? (
        <>
          <p className="muted small" style={{ margin: "0 4px 10px" }}>
            Drag to change the batting order. Sit out anyone who isn't playing today.
          </p>
          <SortableList items={lineup} keyOf={(p) => p.id} sorting onReorder={saveOrder}>
            {(p) => (
              <div className="player-row">
                <span className="jersey">{p.number}</span>
                <span className="player-name truncate grow">{p.name}</span>
                <button className="small-button" onClick={() => setAvailable(p, false)}>
                  Sit out
                </button>
              </div>
            )}
          </SortableList>
        </>
      ) : (
        <ol className="lineup">
          {lineup.map((p) => {
            const atBat = p.id === atBatId;
            return (
              <li key={p.id}>
                <button
                  className={`bat-row${atBat ? " at-bat" : ""}${p.id === onDeck?.id && !atBat ? " on-deck" : ""}`}
                  onClick={() => tap(p)}
                >
                  <span className="bat-number">{p.number}</span>
                  <span className="stack grow" style={{ gap: 3, minWidth: 0 }}>
                    <span className="bat-name truncate">{p.name}</span>
                    {status(p)}
                  </span>
                  {p.id === onDeck?.id && !atBat && <span className="tag on-deck-tag">On deck</span>}
                  {p.clip && (
                    <span className="bat-action" aria-hidden>
                      {sound?.playerId === p.id && sound.state !== "loading" ? <StopIcon /> : <PlayIcon />}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {bench.length > 0 && (
        <>
          <div className="section-title" style={{ margin: "22px 4px 8px" }}>
            Bench today
          </div>
          <ul className="list bench">
            {bench.map((p) => (
              <li key={p.id} className="list-item">
                <div className="player-row">
                  <span className="jersey">{p.number}</span>
                  <span className="player-name truncate grow">{p.name}</span>
                  {editing && (
                    <button className="small-button" onClick={() => setAvailable(p, true)}>
                      Back in
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
