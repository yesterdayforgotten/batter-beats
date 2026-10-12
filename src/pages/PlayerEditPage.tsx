import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { loadClip, Playback, unlockAudio } from "../audio/engine.ts";
import { PageHead } from "../components/PageHead.tsx";
import { PlayIcon, SoundBars } from "../components/Icons.tsx";
import { SongPicker } from "../components/SongPicker.tsx";
import { Waveform } from "../components/Waveform.tsx";
import { ANNOUNCER, CLIP_LIMITS, type Clip, type Player, type RosterSummary, type Song } from "../../shared/types.ts";
import { teamStyle } from "../teamColors.ts";

type ClipChanges = Partial<Pick<Clip, "startMs" | "endMs" | "fadeMs" | "volume" | "gainDb" | "bassDb" | "trebleDb">>;
type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_DELAY_MS = 400;
const NUDGE_MS = 100;

const formatTime = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
const formatDb = (db: number) => `${db > 0 ? "+" : db < 0 ? "−" : ""}${Math.abs(db).toFixed(1)} dB`;

export function PlayerEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [player, setPlayer] = useState<Player | null>(null);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [pronunciation, setPronunciation] = useState("");
  const [songDelayMs, setSongDelayMs] = useState(0);
  const [listening, setListening] = useState(false);
  const delayTimer = useRef<number | undefined>(undefined);
  const [clip, setClip] = useState<Clip | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);

  // Clip changes not yet sent, and the request in flight.
  const unsent = useRef<ClipChanges>({});
  const timer = useRef<number | undefined>(undefined);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const playback = useRef<Playback | null>(null);

  /** The player's team colour, so this screen matches the team's other screens. */
  const [teamColor, setTeamColor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!player) return;
    api<{ rosters: RosterSummary[] }>("/rosters")
      .then((r) => setTeamColor(r.rosters.find((t) => t.id === player.rosterId)?.color))
      .catch(() => {});
  }, [player?.rosterId]);

  useEffect(() => {
    api<{ player: Player }>(`/players/${id}`)
      .then((r) => {
        setPlayer(r.player);
        setName(r.player.name);
        setNumber(r.player.number);
        setPronunciation(r.player.pronunciation);
        setSongDelayMs(r.player.songDelayMs);
        setClip(r.player.clip);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const songId = clip?.song.id;
  useEffect(() => {
    if (!songId) return;
    setPeaks(null);
    api<number[]>(`/songs/${songId}/peaks`).then(setPeaks).catch(() => setPeaks([]));
  }, [songId]);

  // ── Saving ───────────────────────────────────────────────────────────

  const send = useCallback(() => {
    window.clearTimeout(timer.current);
    const changes = unsent.current;
    if (Object.keys(changes).length === 0) return inFlight.current;
    unsent.current = {};
    setSaveState("saving");
    inFlight.current = inFlight.current.then(async () => {
      try {
        const r = await api<{ player: Player }>(`/players/${id}/clip`, { method: "PATCH", body: changes });
        // Keep edits made while this request was on its way.
        setClip(r.player.clip && { ...r.player.clip, ...unsent.current });
        setSaveState(Object.keys(unsent.current).length ? "saving" : "saved");
      } catch (err) {
        setSaveState("error");
        setError((err as Error).message);
      }
    });
    return inFlight.current;
  }, [id]);

  useEffect(
    () => () => {
      // Leaving the screen: save anything pending and stop the preview.
      void send();
      playback.current?.stop();
    },
    [send],
  );

  function change(changes: ClipChanges, saveNow = false) {
    setClip((c) => (c ? { ...c, ...changes } : c));
    unsent.current = { ...unsent.current, ...changes };
    playback.current?.update(changes);
    window.clearTimeout(timer.current);
    if (saveNow) void send();
    else timer.current = window.setTimeout(send, SAVE_DELAY_MS);
  }

  /** Saves name, number and announcer settings; returns the updated player. */
  async function savePlayer(extra: Partial<Pick<Player, "announce" | "songDelayMs">> = {}): Promise<Player | null> {
    if (!player) return null;
    const unchanged =
      name.trim() === player.name &&
      number.trim() === player.number &&
      pronunciation.trim() === player.pronunciation &&
      Object.keys(extra).length === 0;
    if (unchanged) return player;
    try {
      setSaveState("saving");
      const r = await api<{ player: Player }>(`/players/${player.id}`, {
        method: "PATCH",
        body: { name, number, pronunciation, ...extra },
      });
      setPlayer(r.player);
      setName(r.player.name);
      setNumber(r.player.number);
      setPronunciation(r.player.pronunciation);
      setSaveState("saved");
      return r.player;
    } catch (err) {
      setError((err as Error).message);
      setSaveState("error");
      return null;
    }
  }

  function changeDelay(ms: number) {
    setSongDelayMs(ms);
    window.clearTimeout(delayTimer.current);
    delayTimer.current = window.setTimeout(() => void savePlayer({ songDelayMs: ms }), SAVE_DELAY_MS);
  }

  /** Saves any changes, then waits for the server to bring the announcement up to date. */
  async function freshAnnouncement(): Promise<Player | null> {
    window.clearTimeout(delayTimer.current);
    const saved = await savePlayer({ songDelayMs });
    if (!saved || saved.announcementStatus === "off") return saved;
    const r = await api<{ player: Player }>(`/players/${saved.id}/announcement`, { method: "POST", body: {} });
    setPlayer(r.player);
    return r.player;
  }

  async function listen() {
    unlockAudio(); // must happen inside the tap
    stopPreview();
    setListening(true);
    try {
      const p = await freshAnnouncement();
      if (!p?.announcement) {
        throw new Error(p?.announcementError ?? "The announcer is off for this player or this team.");
      }
      const voice = await loadClip(p.announcement.url);
      const pb = new Playback(null, null, { buffer: voice, songDelayMs: 0 });
      playback.current = pb;
      pb.onEnded = () => {
        if (playback.current === pb) playback.current = null;
        setListening(false);
      };
    } catch (err) {
      setError((err as Error).message);
      setListening(false);
    }
  }

  async function pickSong(song: Song) {
    setPicking(false);
    stopPreview();
    setSaveState("saving");
    try {
      await send();
      const r = await api<{ player: Player }>(`/players/${id}/song`, { method: "PUT", body: { songId: song.id } });
      setClip(r.player.clip);
      setSaveState("saved");
    } catch (err) {
      setError((err as Error).message);
      setSaveState("error");
    }
  }

  async function deletePlayer() {
    if (!player || !confirm(`Delete ${player.name} from the team? Their song stays in the library.`)) return;
    stopPreview();
    await api(`/players/${player.id}`, { method: "DELETE" });
    navigate(`/rosters/${player.rosterId}/edit`, { replace: true });
  }

  // ── Preview ──────────────────────────────────────────────────────────

  function stopPreview() {
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
    setPlayheadMs(null);
  }

  async function togglePreview() {
    unlockAudio(); // must happen inside the tap
    if (playback.current?.playing) {
      playback.current.fadeOut();
      return;
    }
    setPlaying(true);
    try {
      await send();
      await inFlight.current;
      // Read the newest clip details after saving.
      const current = await new Promise<Clip | null>((resolve) => setClip((c) => (resolve(c), c)));
      if (!current?.url) throw new Error("The clip isn't ready yet.");
      // Exactly as in game mode: the announcement first, with the song underneath.
      const fresh = await freshAnnouncement();
      const [buffer, voice] = await Promise.all([
        loadClip(current.url),
        fresh?.announcement ? loadClip(fresh.announcement.url).catch(() => null) : null,
      ]);
      const p = new Playback(buffer, current, voice && { buffer: voice, songDelayMs });
      playback.current = p;
      p.onEnded = () => {
        if (playback.current === p) stopPreview();
      };
      const tick = () => {
        if (playback.current !== p || !p.playing) return;
        setPlayheadMs(current.startMs + p.position * 1000);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) {
      setError((err as Error).message);
      setPlaying(false);
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────

  if (!player) {
    return (
      <>
        <PageHead back="/" eyebrow="Edit player" />
        {error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </>
    );
  }

  const saveLabel = { idle: "", saving: "Saving…", saved: "Saved ✓", error: "Not saved" }[saveState];
  const maxGain = clip?.maxGainDb ?? 0;

  return (
    <div style={teamStyle(teamColor)}>
      <PageHead
        done={`/rosters/${player.rosterId}/edit`}
        eyebrow="Edit player"
        title={
          <div className="display truncate" style={{ fontSize: 30 }}>
            {player.number ? `#${player.number} ` : ""}
            {player.name}
          </div>
        }
        right={<span className="save-state" style={saveState === "error" ? { color: "var(--danger)" } : undefined}>{saveLabel}</span>}
      />
      <div className="stack">
        <div className="row">
          <input
            className="number-input"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onBlur={() => void savePlayer()}
            aria-label="Number"
            inputMode="numeric"
            maxLength={4}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void savePlayer()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Name on lineup"
            maxLength={80}
          />
        </div>

        {error && (
          <p className="error" role="alert" onClick={() => setError(null)}>
            {error}
          </p>
        )}


        <div className="card stack">
          <div className="row">
            <span className="section-title">Clip</span>
            <span className="muted small truncate grow">
              {clip ? `${clip.song.title}${clip.song.artist ? ` · ${clip.song.artist}` : ""}` : ""}
            </span>
            <button className="link-button" style={{ color: "var(--accent)" }} onClick={() => setPicking(true)}>
              {clip ? "Change" : "Choose song"}
            </button>
          </div>
          {!clip && (
            <button className="add-button" onClick={() => setPicking(true)}>
              Choose a song from the library or upload one
            </button>
          )}
          {clip && (
            <>
              {peaks ? (
                <Waveform
                  peaks={peaks}
                  durationMs={clip.song.durationMs}
                  startMs={clip.startMs}
                  endMs={clip.endMs}
                  fadeMs={clip.fadeMs}
                  playheadMs={playheadMs}
                  onChange={(startMs, endMs) => change({ startMs, endMs }, false)}
                  onCommit={(startMs, endMs) => change({ startMs, endMs }, true)}
                />
              ) : (
                <div className="waveform" />
              )}
              <div className="nudge">
                <div>
                  <button aria-label="Start earlier" onClick={() => change({ startMs: Math.max(0, clip.startMs - NUDGE_MS) })}>
                    −.1
                  </button>
                  <span className="time">{formatTime(clip.startMs)}</span>
                  <button
                    aria-label="Start later"
                    onClick={() => change({ startMs: Math.min(clip.endMs - CLIP_LIMITS.minLengthMs, clip.startMs + NUDGE_MS) })}
                  >
                    +.1
                  </button>
                </div>
                <span style={{ color: "var(--accent)", fontWeight: 800 }}>{((clip.endMs - clip.startMs) / 1000).toFixed(1)} s</span>
                <div>
                  <button
                    aria-label="End earlier"
                    onClick={() => change({ endMs: Math.max(clip.startMs + CLIP_LIMITS.minLengthMs, clip.endMs - NUDGE_MS) })}
                  >
                    −.1
                  </button>
                  <span className="time">{formatTime(clip.endMs)}</span>
                  <button aria-label="End later" onClick={() => change({ endMs: Math.min(clip.song.durationMs, clip.endMs + NUDGE_MS) })}>
                    +.1
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {clip && (
          <div className="card editor-rows">
            <div className="editor-row">
              <span className="label">Gain</span>
              <button
                className="stepper"
                aria-label="Less gain"
                disabled={clip.gainDb <= CLIP_LIMITS.minGainDb}
                onClick={() => change({ gainDb: Math.max(CLIP_LIMITS.minGainDb, clip.gainDb - CLIP_LIMITS.gainStepDb) })}
              >
                −
              </button>
              <span className="gain-value">{formatDb(clip.gainDb)}</span>
              <button
                className="stepper"
                aria-label="More gain"
                disabled={clip.gainDb >= maxGain}
                onClick={() => change({ gainDb: Math.min(maxGain, clip.gainDb + CLIP_LIMITS.gainStepDb) })}
              >
                +
              </button>
              <span className="value small" style={{ fontWeight: 700, color: "var(--muted)", lineHeight: 1.2 }}>
                {clip.gainDb >= maxGain ? "loudest safe" : `max ${formatDb(maxGain).replace(" dB", "")}`}
              </span>
            </div>
            <label className="editor-row">
              <span className="label">Volume</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(clip.volume * 100)}
                onChange={(e) => change({ volume: Number(e.target.value) / 100 })}
              />
              <span className="value">{Math.round(clip.volume * 100)}%</span>
            </label>
            <label className="editor-row">
              <span className="label">Fade-out</span>
              <input
                type="range"
                min={0}
                max={Math.min(CLIP_LIMITS.maxFadeMs, clip.endMs - clip.startMs)}
                step={500}
                value={clip.fadeMs}
                onChange={(e) => change({ fadeMs: Number(e.target.value) })}
              />
              <span className="value">{(clip.fadeMs / 1000).toFixed(1)} s</span>
            </label>
            <label className="editor-row">
              <span className="label">Bass</span>
              <input
                type="range"
                min={CLIP_LIMITS.toneMinDb}
                max={CLIP_LIMITS.toneMaxDb}
                step={1}
                value={clip.bassDb}
                onChange={(e) => change({ bassDb: Number(e.target.value) })}
              />
              <span className="value">{formatDb(clip.bassDb).replace(".0", "")}</span>
            </label>
            <label className="editor-row">
              <span className="label">Treble</span>
              <input
                type="range"
                min={CLIP_LIMITS.toneMinDb}
                max={CLIP_LIMITS.toneMaxDb}
                step={1}
                value={clip.trebleDb}
                onChange={(e) => change({ trebleDb: Number(e.target.value) })}
              />
              <span className="value">{formatDb(clip.trebleDb).replace(".0", "")}</span>
            </label>
          </div>
        )}

        {clip && (
          <button className={`preview ${playing ? "playing" : "primary"}`} onClick={togglePreview}>
            {playing ? <SoundBars /> : <PlayIcon />}
            {playing ? "Playing · tap to fade out" : "Preview as in game"}
          </button>
        )}

        <AnnouncerCard
          player={player}
          name={name}
          pronunciation={pronunciation}
          setPronunciation={setPronunciation}
          songDelayMs={songDelayMs}
          onDelay={changeDelay}
          onSave={() => void savePlayer()}
          onToggle={(announce) => void savePlayer({ announce })}
          listening={listening}
          onListen={listen}
        />

        <button className="danger" style={{ marginTop: 20, alignSelf: "center" }} onClick={deletePlayer}>
          Delete player
        </button>
      </div>
      {picking && (
        <SongPicker
          selectedId={clip?.song.id}
          player={{ name: player.name, rosterId: player.rosterId }}
          onPick={pickSong}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function delayLabel(ms: number, voiceMs: number | null): string {
  if (ms === 0) return "With the voice";
  const sec = `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 2).replace(/0$/, "")} s`;
  if (voiceMs !== null && ms >= voiceMs) return `${sec} (after the voice)`;
  return `${sec} into the voice`;
}

/** The announcer part of the player editor: spelling, on/off, and when the song comes in. */
function AnnouncerCard(props: {
  player: Player;
  name: string;
  pronunciation: string;
  setPronunciation(v: string): void;
  songDelayMs: number;
  onDelay(ms: number): void;
  onSave(): void;
  onToggle(announce: boolean): void;
  listening: boolean;
  onListen(): void;
}) {
  const { player } = props;
  const voiceMs = player.announcement?.durationMs ?? null;
  // The slider reaches a couple of seconds past the end of the voice.
  const maxDelay = Math.min(ANNOUNCER.maxSongDelayMs, Math.max(4000, Math.ceil(((voiceMs ?? 3000) + 2000) / 250) * 250));
  const teamOff = player.announce && player.announcementStatus === "off";

  return (
    <div className="card stack">
      <div className="row">
        <span className="section-title grow">Announcer</span>
        <button
          role="switch"
          aria-checked={player.announce}
          className={`switch${player.announce ? " on" : ""}`}
          onClick={() => props.onToggle(!player.announce)}
        >
          <span className="switch-label">Announce</span>
          <span className="switch-track">
            <span className="switch-knob" />
          </span>
        </button>
      </div>
      {teamOff && <p className="muted small" style={{ margin: 0 }}>The announcer is off for this team. Turn it on in Edit team.</p>}
      {player.announce && !teamOff && (
        <>
          <label>
            Say it like this
            <div className="row">
              <input
                value={props.pronunciation}
                onChange={(e) => props.setPronunciation(e.target.value)}
                onBlur={props.onSave}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder={props.name}
                maxLength={200}
              />
              <button className="small-button" onClick={props.onListen} disabled={props.listening} style={{ minHeight: 48 }}>
                {props.listening ? "…" : "Listen"}
              </button>
            </div>
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            Only the announcer uses this; the lineup still shows the name. Spell it how it sounds (for example
            "Kay-den"). For exact sounds, use phonetic symbols like [Siobhan](/ʃɪvˈɔːn/).
          </p>
          {player.announcementStatus === "error" && (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {player.announcementError}
            </p>
          )}
          <div className="editor-row" style={{ borderBottom: "none" }}>
            <span className="label">Song in</span>
            <input
              type="range"
              className="grow"
              min={0}
              max={maxDelay}
              step={250}
              value={Math.min(props.songDelayMs, maxDelay)}
              onChange={(e) => props.onDelay(Number(e.target.value))}
              aria-label="When the song comes in"
            />
            <span className="value">{(props.songDelayMs / 1000).toFixed(props.songDelayMs % 1000 === 0 ? 0 : 2).replace(/(\.\d)0$/, "$1")} s</span>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Song comes in: <strong>{delayLabel(props.songDelayMs, voiceMs)}</strong>
            {props.songDelayMs < (voiceMs ?? Infinity) ? ", quietly under the voice, then up to full volume." : "."}
          </p>
        </>
      )}
    </div>
  );
}
