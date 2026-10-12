import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, isNetworkError } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { fetchClip, loadClip, Playback, unlockAudio } from "../audio/engine.ts";
import { PlayIcon, SkipIcon, SoundBars, StopIcon } from "../components/Icons.tsx";
import { MoreMenu } from "../components/MoreMenu.tsx";
import { PageHead } from "../components/PageHead.tsx";
import { SortableList } from "../components/SortableList.tsx";
import { AppVersion } from "../components/AppVersion.tsx";
import { changeLineup, onOfflineChange, savedRoster, saveIfKept, stuckChanges, withPendingChanges } from "../offline.ts";
import { cameFromGame } from "../editReturn.ts";
import { teamStyle } from "../teamColors.ts";
import { allowSleep, keepAwake } from "../wakeLock.ts";
import {
  BATTER_FADE_SEC,
  jukebox,
  jukeboxSettings,
  loadPlaylists,
  onPlaylistChange,
  setTeamPlaylist,
  teamPlaylistId,
} from "../playlist.ts";
import { JukeboxPanel } from "../components/JukeboxPanel.tsx";
import type { Player, Playlist, Roster } from "../../shared/types.ts";

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
  /** True when the roster came from this phone's saved copy because the server couldn't be reached. */
  const [fromPhone, setFromPhone] = useState(false);
  /** Lineup changes still unsent after a few tries (one blip isn't worth a message). */
  const [waiting, setWaiting] = useState(() => stuckChanges());
  const [reloads, setReloads] = useState(0);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [jukeboxState, setJukeboxState] = useState(jukebox.state);
  const [settings, setSettings] = useState(jukeboxSettings);
  const [chosenPlaylist, setChosenPlaylist] = useState(() => teamPlaylistId(id ?? ""));
  /** Lineup or Jukebox, remembered for this team while the app is open. */
  const [tab, setTabState] = useState<"lineup" | "jukebox">(() => {
    try {
      return sessionStorage.getItem(`bb.gameTab.${id}`) === "jukebox" ? "jukebox" : "lineup";
    } catch {
      return "lineup";
    }
  });
  const setTab = (t: "lineup" | "jukebox") => {
    setTabState(t);
    try {
      sessionStorage.setItem(`bb.gameTab.${id}`, t);
    } catch {
      // ignore
    }
  };
  // Reorder is its own history entry, so Back (the arrow, or the phone's back gesture) returns to game mode.
  const location = useLocation();
  const navigate = useNavigate();
  const editing = (location.state as { reorder?: boolean } | null)?.reorder === true;
  const setEditing = (on: boolean) => {
    if (on) navigate(location.pathname, { state: { reorder: true } });
    // Leaving steps back over that entry; after a reload with nowhere to step back to, just clear it.
    else if (location.key !== "default") navigate(-1);
    else navigate(location.pathname, { replace: true, state: null });
  };
  const [atBatId, setAtBatId] = useState<number | null>(() => readAtBat(id));
  const [sound, setSound] = useState<{ playerId: number; state: "loading" | "playing" | "fading" } | null>(null);
  const playback = useRef<Playback | null>(null);
  const tapCount = useRef(0);

  useEffect(() => {
    const show = (r: Roster) => {
      setRoster(r);
      // Fetch every clip now (from the phone if saved there) so taps don't wait.
      for (const p of r.players) {
        for (const url of [p.clip?.url, p.announcement?.url]) if (url) void fetchClip(url).catch(() => {});
      }
    };
    api<{ roster: Roster }>(`/rosters/${id}`, { timeoutMs: 5000 })
      .then((r) => {
        const roster = withPendingChanges(r.roster);
        saveIfKept(roster);
        setFromPhone(false);
        show(roster);
      })
      .catch((err) => {
        const saved = isNetworkError(err) ? savedRoster(Number(id)) : null;
        if (saved) {
          setFromPhone(true);
          show(saved);
        } else if (isNetworkError(err)) {
          setError("No connection, and this team isn't saved on this phone. Turn on Offline for it on the Teams screen before the game.");
        } else {
          setError(err.message);
        }
      });
  }, [id, reloads]);

  // Connection back: fetch the current lineup again (queued changes are sent first, by offline.ts).
  useEffect(() => {
    const back = () => setTimeout(() => setReloads((n) => n + 1), 1500);
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  useEffect(() => onOfflineChange(() => setWaiting(stuckChanges())), []);

  // Playlists for the jukebox.
  useEffect(() => {
    loadPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch(() => setPlaylists([]));
    return onPlaylistChange(() => {
      setJukeboxState(jukebox.state);
      setSettings(jukeboxSettings());
    });
  }, []);

  // Leaving game mode: stop the music and let the screen sleep.
  useEffect(
    () => () => {
      playback.current?.stop();
      jukebox.stop();
      allowSleep();
    },
    [],
  );

  /** The team's playlist: the one chosen on this phone, or the first one. */
  const playlist = playlists?.find((p) => p.id === chosenPlaylist) ?? playlists?.[0] ?? null;

  function choosePlaylist(playlistId: number) {
    setChosenPlaylist(playlistId);
    if (id) setTeamPlaylist(id, playlistId);
  }

  function playJukebox(p: Playlist, songId?: number) {
    unlockAudio(); // must start inside the tap
    keepAwake();
    // A walkup still playing gets out of the way.
    playback.current?.fadeOut(SWITCH_FADE_SEC);
    playback.current = null;
    setSound(null);
    jukebox.play(p, songId);
  }

  const order = roster?.players ?? [];
  const lineup = order.filter((p) => p.available);
  const bench = order.filter((p) => !p.available);
  const onDeck = useMemo(() => nextBatter(order, atBatId), [order, atBatId]);

  // Have the on-deck batter's announcement and song decoded and ready before anyone taps.
  useEffect(() => {
    for (const url of [onDeck?.announcement?.url, onDeck?.clip?.url]) if (url) void loadClip(url).catch(() => {});
  }, [onDeck?.clip?.url, onDeck?.announcement?.url]);

  async function tap(player: Player) {
    unlockAudio(); // both of these must start inside the tap
    keepAwake();
    jukebox.fadeOut(BATTER_FADE_SEC); // the jukebox fades out for the batter
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
    const clip = player.clip?.url ? player.clip : null;
    const announcement = player.announcement;
    if (!clip && !announcement) {
      setSound(null);
      return;
    }
    setSound({ playerId: player.id, state: "loading" });
    try {
      const [buffer, voice] = await Promise.all([
        clip ? loadClip(clip.url!) : null,
        // A missing announcement shouldn't stop the song.
        announcement ? loadClip(announcement.url).catch(() => null) : null,
      ]);
      if (tapId !== tapCount.current) return; // another batter was tapped meanwhile
      const p = new Playback(buffer, clip, voice && { buffer: voice, songDelayMs: player.songDelayMs });
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

  // Lineup changes apply on this phone at once and are sent to the server, or
  // queued until there's a connection (see offline.ts).
  function saveOrder(newLineup: Player[]) {
    if (!roster) return;
    setRoster(changeLineup(roster, { kind: "order", playerIds: [...newLineup, ...bench].map((p) => p.id) }));
  }

  function setAvailable(player: Player, available: boolean) {
    if (!roster) return;
    setRoster(changeLineup(roster, { kind: "available", playerId: player.id, available }));
  }

  /** The line under a batter's name: what's happening with their sound, otherwise their song. */
  function status(p: Player) {
    if (sound?.playerId === p.id) {
      if (sound.state === "loading") return <span className="bat-status">Loading…</span>;
      if (sound.state === "fading") return <span className="bat-status">Fading out</span>;
      return (
        <span className="bat-status">
          <SoundBars /> <span className="truncate">{p.clip?.song.title ?? "Announcement"}</span>
        </span>
      );
    }
    if (!p.clip) return <span className="bat-status muted">No song</span>;
    return (
      <span className="bat-status song">
        <span className="truncate">{p.clip.song.title}</span>
      </span>
    );
  }

  return (
    <div style={teamStyle(roster?.color)}>
      <PageHead
        back="/"
        onBack={editing ? () => setEditing(false) : undefined}
        eyebrow={editing ? "Reorder" : "Game mode"}
        title={<div className="display truncate" style={{ fontSize: 30, color: "var(--accent)" }}>{roster?.name ?? ""}</div>}
        right={
          editing ? (
            <button className="link-button" style={{ color: "var(--accent)", padding: "8px 6px" }} onClick={() => setEditing(false)}>
              Done
            </button>
          ) : (
            <MoreMenu
              items={[
                {
                  label: "Reorder",
                  onSelect: () => {
                    setTab("lineup");
                    setEditing(true);
                  },
                },
                ...(hasRole(user, "editor") && roster && !fromPhone
                  ? [{ label: "Edit Team", to: `/rosters/${roster.id}/edit`, onSelect: () => cameFromGame(roster.id) }]
                  : []),
              ]}
            />
          )
        }
      />
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {(fromPhone || waiting > 0) && (
        <p className="notice">
          {fromPhone ? "No connection. Playing from this phone. " : ""}
          {waiting > 0
            ? `${waiting} lineup ${waiting === 1 ? "change" : "changes"} will be sent when there's a connection.`
            : ""}
        </p>
      )}
      {!editing && (
        <div className="segmented game-tabs" role="tablist">
          {(["lineup", "jukebox"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "lineup" ? "Lineup" : "Jukebox"}
            </button>
          ))}
        </div>
      )}
      {!editing && tab === "jukebox" && playlists && (
        <JukeboxPanel
          playlists={playlists}
          selected={playlist}
          state={jukeboxState}
          settings={settings}
          editor={hasRole(user, "editor") && !fromPhone}
          onSelect={choosePlaylist}
          onPlay={playJukebox}
        />
      )}
      {(editing || tab === "lineup") && roster && order.length === 0 && <p className="empty">No players on this roster yet.</p>}

      {!editing && tab === "jukebox" ? null : editing ? (
        <>
          <p className="muted small" style={{ margin: "0 4px 10px" }}>
            Drag to change the batting order. Tap Away for anyone who isn't playing today.
          </p>
          <SortableList items={lineup} keyOf={(p) => p.id} sorting compact onReorder={saveOrder}>
            {(p) => (
              <div className="player-row">
                <span className="jersey">{p.number}</span>
                <span className="player-name truncate grow">{p.name}</span>
                <button className="small-button" onClick={() => setAvailable(p, false)}>
                  Away
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
                  {atBat && <span className="tag at-bat-tag">At bat</span>}
                  {p.id === onDeck?.id && !atBat && <span className="tag on-deck-tag">On deck</span>}
                  {(p.clip || p.announcement) && (
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

      {bench.length > 0 && (editing || tab === "lineup") && (
        <>
          <div className="section-title" style={{ margin: "22px 4px 8px" }}>
            Unavailable
          </div>
          <ul className={`list bench${editing ? " compact" : ""}`}>
            {bench.map((p) => (
              <li key={p.id} className="list-item">
                <div className="player-row">
                  <span className="jersey">{p.number}</span>
                  <span className="player-name truncate grow">{p.name}</span>
                  {editing && (
                    <button className="small-button" onClick={() => setAvailable(p, true)}>
                      Back
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {!editing && playlists && <NowPlaying state={jukeboxState} playlist={playlist} onPlay={playJukebox} />}
      <footer style={{ marginTop: 28 }}>
        <AppVersion />
      </footer>
    </div>
  );
}

/**
 * The bar along the bottom of game mode, on both tabs: what the jukebox is
 * playing, with Stop (fades out) and Skip; or, when it's quiet, one tap to
 * start the team's playlist.
 */
function NowPlaying({
  state,
  playlist,
  onPlay,
}: {
  state: typeof jukebox.state;
  playlist: Playlist | null;
  onPlay(p: Playlist): void;
}) {
  if (state.status === "stopped") {
    if (!playlist) {
      return (
        <div className="innings-bar">
          <Link to="/playlists" className="innings-setup">
            Set up a playlist for the jukebox
          </Link>
        </div>
      );
    }
    return (
      <div className="innings-bar">
        <button className="innings-button" disabled={playlist.songs.length === 0} onClick={() => onPlay(playlist)}>
          <PlayIcon />
          <span className="stack grow" style={{ gap: 1, minWidth: 0, textAlign: "left" }}>
            <span className="innings-title">Jukebox</span>
            <span className="innings-song truncate">
              {playlist.name} · {playlist.songs.length} {playlist.songs.length === 1 ? "song" : "songs"}
            </span>
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="innings-bar">
      <div className="innings-button on">
        <button className="bar-icon" aria-label="Stop the jukebox" disabled={state.status === "fading"} onClick={() => jukebox.fadeOut()}>
          <StopIcon />
        </button>
        <span className="stack grow" style={{ gap: 1, minWidth: 0, textAlign: "left" }}>
          <span className="innings-title truncate">{state.song.title}</span>
          <span className="innings-song truncate">
            {state.status === "fading" ? "Fading out · " : state.status === "loading" ? "Loading… · " : ""}
            {state.song.artist ? `${state.song.artist} · ` : ""}
            {state.playlist.name}
          </span>
        </span>
        <button className="bar-icon" aria-label="Next song" disabled={state.status === "fading"} onClick={() => jukebox.skip()}>
          <SkipIcon />
        </button>
      </div>
    </div>
  );
}
