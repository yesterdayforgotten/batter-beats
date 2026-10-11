import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { loadClip, Playback, unlockAudio } from "../audio/engine.ts";
import { PageHead } from "../components/PageHead.tsx";
import { PlayIcon, SoundBars } from "../components/Icons.tsx";
import { SongPicker } from "../components/SongPicker.tsx";
import { Waveform } from "../components/Waveform.tsx";
import { CLIP_LIMITS, type Clip, type Player, type Song } from "../../shared/types.ts";

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

  useEffect(() => {
    api<{ player: Player }>(`/players/${id}`)
      .then((r) => {
        setPlayer(r.player);
        setName(r.player.name);
        setNumber(r.player.number);
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

  async function savePlayer() {
    if (!player || (name.trim() === player.name && number.trim() === player.number)) return;
    try {
      setSaveState("saving");
      const r = await api<{ player: Player }>(`/players/${player.id}`, { method: "PATCH", body: { name, number } });
      setPlayer(r.player);
      setName(r.player.name);
      setNumber(r.player.number);
      setSaveState("saved");
    } catch (err) {
      setError((err as Error).message);
      setSaveState("error");
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
    if (!player || !confirm(`Remove ${player.name} from the roster?`)) return;
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
      const buffer = await loadClip(current.url);
      const p = new Playback(buffer, current);
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
        {error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}
      </>
    );
  }

  const saveLabel = { idle: "", saving: "Saving…", saved: "Saved ✓", error: "Not saved" }[saveState];
  const maxGain = clip?.maxGainDb ?? 0;

  return (
    <>
      <PageHead
        back={`/rosters/${player.rosterId}/edit`}
        eyebrow="Edit player"
        right={<span className="save-state" style={saveState === "error" ? { color: "var(--danger)" } : undefined}>{saveLabel}</span>}
      />
      <div className="stack">
        <div className="row">
          <input
            className="number-input"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onBlur={savePlayer}
            aria-label="Number"
            inputMode="numeric"
            maxLength={4}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={savePlayer}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Name on lineup"
            maxLength={80}
          />
        </div>

        {error && (
          <p className="error" onClick={() => setError(null)}>
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

        <button className="danger" style={{ marginTop: 20, alignSelf: "center" }} onClick={deletePlayer}>
          Remove player
        </button>
      </div>
      {picking && <SongPicker selectedId={clip?.song.id} onPick={pickSong} onClose={() => setPicking(false)} />}
    </>
  );
}
