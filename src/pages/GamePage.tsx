import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, isNetworkError } from "../api.ts";
import { hasRole, useAuth } from "../auth.tsx";
import { fetchClip, loadClip, Playback, unlockAudio } from "../audio/engine.ts";
import { EditIcon, MusicIcon, PlayIcon, ReorderIcon, SkipIcon, SoundBars, StopIcon } from "../components/Icons.tsx";
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
  keepsPlaylist,
  loadPlaylists,
  onPlaylistChange,
  setTeamPlaylist,
  teamPlaylistId,
} from "../playlist.ts";
import { JukeboxPanel } from "../components/JukeboxPanel.tsx";
import type { Player, Playlist, Roster } from "../../shared/types.ts";

/**
 * After a batter's song stops (forced, or the fade ran out), taps on that batter
 * are ignored this long, so a tap meant to stop it doesn't start it again.
 */
const RESTART_GUARD_MS = 800;

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
  /** No connection when the playlists were loaded: only the ones kept on this phone can play. */
  const [playlistsOffline, setPlaylistsOffline] = useState(false);
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
  /** Which batter's song stopped last, and when (see RESTART_GUARD_MS). */
  const lastStop = useRef<{ playerId: number; at: number } | null>(null);

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

  // Playlists for the jukebox (fetched again when the connection comes back).
  useEffect(() => {
    loadPlaylists()
      .then((r) => {
        setPlaylists(r.playlists);
        setPlaylistsOffline(r.offline);
      })
      .catch(() => setPlaylists([]));
  }, [reloads]);

  useEffect(
    () =>
      onPlaylistChange(() => {
        setJukeboxState(jukebox.state);
        setSettings(jukeboxSettings());
      }),
    [],
  );

  // Leaving game mode: stop the music and let the screen sleep.
  useEffect(
    () => () => {
      playback.current?.stop();
      jukebox.stop();
      allowSleep();
    },
    [],
  );

  // Without a connection only playlists kept on this phone can play; with none of
  // those the jukebox is left out altogether (unless something is still playing).
  const offline = playlistsOffline || fromPhone;
  const playable = offline ? (playlists ?? []).filter((p) => keepsPlaylist(p.id) && p.songs.length > 0) : playlists;
  const showJukebox = !offline || (playable?.length ?? 0) > 0 || jukeboxState.status !== "stopped";
  const shownTab = showJukebox ? tab : "lineup";

  /** The team's playlist: the one chosen on this phone, or the first one. */
  const playlist = playable?.find((p) => p.id === chosenPlaylist) ?? playable?.[0] ?? null;

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

    // A tap that arrives just after this batter's song stopped was meant to stop it: ignore it.
    if (lastStop.current?.playerId === player.id && performance.now() - lastStop.current.at < RESTART_GUARD_MS) return;

    // Tapping the batter whose song is playing fades it out; tapping again while it fades stops it at once.
    if (player.id === sound?.playerId && current?.playing) {
      if (!current.fading) {
        current.fadeOut();
        setSound({ playerId: player.id, state: "fading" });
      } else {
        current.stop();
        playback.current = null;
        setSound(null);
        lastStop.current = { playerId: player.id, at: performance.now() };
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
          lastStop.current = { playerId: player.id, at: performance.now() };
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
      if (sound.state === "fading") return <span className="bat-status">Fading out · tap to stop</span>;
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

        eyebrow={editing ? "Reorder" : undefined}
        title={
          editing ? (
            <div className="display truncate" style={{ fontSize: 30, color: "var(--accent)" }}>
              {roster?.name ?? ""}
            </div>
          ) : (
            // One compact row: team name, then the Lineup | Jukebox tabs.
            <div className="game-title">
              <span className="game-name">
                <span className="eyebrow">Game mode</span>
                <span className="display truncate">{roster?.name ?? ""}</span>
              </span>
              {/* What the tab's icons do: on Lineup, reorder and edit the team; on Jukebox, edit the playlist. */}
              <span className="head-icons">
                {shownTab === "lineup" && (
                  <button className="head-icon" aria-label="Reorder" onClick={() => setEditing(true)}>
                    <ReorderIcon />
                  </button>
                )}
                {shownTab === "lineup" && hasRole(user, "editor") && roster && !fromPhone && (
                  <Link
                    to={`/rosters/${roster.id}/edit`}
                    className="head-icon"
                    aria-label="Edit team"
                    onClick={() => cameFromGame(roster.id)}
                  >
                    <EditIcon />
                  </Link>
                )}
                {shownTab === "jukebox" && hasRole(user, "editor") && playlist && !offline && (
                  <Link
                    to={`/playlists/${playlist.id}`}
                    state={{ from: location.pathname }}
                    className="head-icon"
                    aria-label="Edit playlist"
                  >
                    <EditIcon />
                  </Link>
                )}
              </span>
              {showJukebox && (
                <div className="segmented game-tabs" role="tablist">
                  {(["lineup", "jukebox"] as const).map((t) => (
                    <button key={t} role="tab" aria-selected={shownTab === t} className={shownTab === t ? "on" : ""} onClick={() => setTab(t)}>
                      {t === "lineup" ? "Lineup" : "Jukebox"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
        right={
          editing ? (
            <button className="link-button head-done" onClick={() => setEditing(false)}>
              Done
            </button>
          ) : undefined
        }
      />
      {error && (
        <p className="error" role="alert" onClick={() => setError(null)}>
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
      {!editing && shownTab === "jukebox" && playable && (
        <JukeboxPanel
          playlists={playable}
          selected={playlist}
          state={jukeboxState}
          settings={settings}
          editor={hasRole(user, "editor") && !fromPhone}
          onSelect={choosePlaylist}
          onPlay={playJukebox}
        />
      )}
      {(editing || shownTab === "lineup") && roster && order.length === 0 && <p className="empty">No players on this roster yet.</p>}

      {!editing && shownTab === "jukebox" ? null : editing ? (
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

      {bench.length > 0 && (editing || shownTab === "lineup") && (
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
      {!editing && playable && showJukebox && (
        <>
          {shownTab === "lineup" && <hr className="section-rule" />}
          <NowPlaying state={jukeboxState} playlist={playlist} onPlay={playJukebox} />
        </>
      )}
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
    const next = jukebox.upNext(playlist);
    return (
      <div className="innings-bar">
        <div className="jukebox-tile">
        <JukeboxHead />
        {/* Like a batter's row: details on the left, Skip, then the play circle on the right. */}
        <div className="innings-button">
          <button className="bar-play" disabled={!next} onClick={() => !jukebox.justStopped() && onPlay(playlist)}>
            <span className="innings-title truncate">{next ? next.title : "Jukebox"}</span>
            <span className="innings-song truncate">
              {next ? `Up next · ${playlist.name}` : `${playlist.name} has no songs yet`}
            </span>
          </button>
          {playlist.songs.length > 1 && (
            // Picks a different song to play next; nothing starts.
            <button className="bar-icon bar-skip" aria-label="Pick a different next song" onClick={() => jukebox.skip(playlist)}>
              <SkipIcon />
            </button>
          )}
          <button
            className="bar-icon"
            aria-label="Play the jukebox"
            disabled={!next}
            onClick={() => !jukebox.justStopped() && onPlay(playlist)}
          >
            <PlayIcon />
          </button>
        </div>
        </div>
      </div>
    );
  }
  return (
    <div className="innings-bar">
      <div className="jukebox-tile on">
      <JukeboxHead />
      <div className="innings-button on">
        <span className="bar-text">
          <span className="innings-title now-title">
            {state.status === "playing" && <SoundBars />}
            <span className="truncate">{state.song.title}</span>
          </span>
          <span className="innings-song truncate">
            {state.status === "fading" ? "Fading out · " : state.status === "loading" ? "Loading… · " : ""}
            {state.song.artist ? `${state.song.artist} · ` : ""}
            {state.playlist.name}
          </span>
        </span>
        <button
          className="bar-icon bar-skip"
          aria-label="Next song"
          disabled={state.status === "fading"}
          onClick={() => jukebox.skip(state.playlist)}
        >
          <SkipIcon />
        </button>
        <button
          className="bar-icon"
          aria-label={state.status === "fading" ? "Stop the jukebox now" : "Stop the jukebox"}
          onClick={() => (state.status === "fading" ? jukebox.stop() : jukebox.fadeOut())}
        >
          <StopIcon />
        </button>
      </div>
      </div>
    </div>
  );
}

/** The jukebox tile's own heading, like the lineup's section titles. */
function JukeboxHead() {
  return (
    <div className="jukebox-head">
      <MusicIcon />
      Jukebox
    </div>
  );
}
