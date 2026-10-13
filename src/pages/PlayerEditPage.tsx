import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { context, loadClip, Playback, toneChain, unlockAudio } from "../audio/engine.ts";
import { PageHead } from "../components/PageHead.tsx";
import {
  ClipEndIcon,
  ClipEndingPlayIcon,
  ClipPlayIcon,
  ClipStartIcon,
  PlayIcon,
  SongPlayIcon,
  SoundBars,
  StopIcon,
} from "../components/Icons.tsx";
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
  /**
   * Listening to the original song (not the game preview): the whole song, the
   * clip from its start, or the clip's last 5 seconds. Used to set the start
   * and end by ear.
   */
  const [listenMode, setListenMode] = useState<"song" | "clip" | "ending" | null>(null);
  const wholeAudio = useRef<HTMLAudioElement | null>(null);
  /** Where that playback stops by itself (the clip's end), if anywhere. */
  const stopAt = useRef<number | null>(null);
  /** Its bass, treble and volume (the clip's settings, applied live as the sliders move). */
  const listenTone = useRef<ReturnType<typeof toneChain> | null>(null);

  // Clip changes not yet sent, and the request in flight.
  const unsent = useRef<ClipChanges>({});
  const timer = useRef<number | undefined>(undefined);
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const playback = useRef<Playback | null>(null);
  /** Bumped whenever a preview or Listen is stopped or replaced, so one still loading knows not to start. */
  const previewToken = useRef(0);

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
        // Not lost: these go again with the next change, or when leaving the screen (newer edits win).
        unsent.current = { ...changes, ...unsent.current };
        setSaveState("error");
        setError((err as Error).message);
      }
    });
    return inFlight.current;
  }, [id]);

  useEffect(
    () => () => {
      // Leaving the screen: save anything pending and stop the preview (or one still loading).
      void send();
      previewToken.current++;
      playback.current?.stop();
      wholeAudio.current?.pause();
    },
    [send],
  );

  function change(changes: ClipChanges, saveNow = false) {
    setClip((c) => (c ? { ...c, ...changes } : c));
    unsent.current = { ...unsent.current, ...changes };
    playback.current?.update(changes);
    if (listenTone.current && clip) {
      const next = { ...clip, ...changes };
      listenTone.current.set({ volume: next.volume, gainDb: next.gainDb, bassDb: next.bassDb, trebleDb: next.trebleDb });
    }
    window.clearTimeout(timer.current);
    if (saveNow) void send();
    else timer.current = window.setTimeout(send, SAVE_DELAY_MS);
  }

  // The latest typed values, for saves that finish after more typing.
  const latest = useRef({ name, number, pronunciation });
  latest.current = { name, number, pronunciation };

  /**
   * Saves name, number and announcer settings; returns the updated player.
   * Only fields that changed are sent, and the reply only replaces a box the
   * user hasn't typed in since (so a slow save can't wipe newer typing).
   */
  async function savePlayer(extra: Partial<Pick<Player, "announce" | "songDelayMs">> = {}): Promise<Player | null> {
    if (!player) return null;
    const sent = { name: name.trim(), number: number.trim(), pronunciation: pronunciation.trim() };
    if (!sent.name) {
      // A player needs a name: put it back rather than blocking every other save.
      setName(player.name);
      sent.name = player.name;
    }
    const body: Record<string, unknown> = { ...extra };
    if (sent.name !== player.name) body.name = sent.name;
    if (sent.number !== player.number) body.number = sent.number;
    if (sent.pronunciation !== player.pronunciation) body.pronunciation = sent.pronunciation;
    if (Object.keys(body).length === 0) return player;
    try {
      setSaveState("saving");
      const r = await api<{ player: Player }>(`/players/${player.id}`, { method: "PATCH", body });
      setPlayer(r.player);
      const now = latest.current;
      if (now.name.trim() === sent.name) setName(r.player.name);
      if (now.number.trim() === sent.number) setNumber(r.player.number);
      if (now.pronunciation.trim() === sent.pronunciation) setPronunciation(r.player.pronunciation);
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

  /** Plays the player's announcement; with `remake`, a new take is made first (each take differs a little). */
  async function listen(remake = false) {
    unlockAudio(); // must happen inside the tap
    stopPreview();
    const token = previewToken.current;
    setListening(true);
    try {
      let p = await freshAnnouncement();
      if (remake && p && p.announcementStatus !== "off") {
        p = (await api<{ player: Player }>(`/players/${p.id}/announcement/remake`, { method: "POST", body: {} })).player;
        setPlayer(p);
      }
      if (!p?.announcement) {
        throw new Error(p?.announcementError ?? "The announcer is off for this player or this team.");
      }
      const voice = await loadClip(p.announcement.url);
      if (token !== previewToken.current) return; // stopped, left, or something else started meanwhile
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
    try {
      await api(`/players/${player.id}`, { method: "DELETE" });
      navigate(`/rosters/${player.rosterId}/edit`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ── Preview ──────────────────────────────────────────────────────────

  function stopPreview() {
    previewToken.current++;
    wholeAudio.current?.pause();
    wholeAudio.current = null;
    listenTone.current?.disconnect();
    listenTone.current = null;
    setListenMode(null);
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
    if (playing) {
      // Tapped again while it's still getting ready: cancel instead of starting a second one.
      stopPreview();
      return;
    }
    stopPreview();
    const token = previewToken.current;
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
      if (token !== previewToken.current) return; // stopped, left the screen, or tapped again meanwhile
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
      if (token !== previewToken.current) return;
      setError((err as Error).message);
      setPlaying(false);
    }
  }

  /** The three listen buttons: each starts its kind of playback, or stops it if it's the one playing. */
  function toggleListen(mode: "song" | "clip" | "ending") {
    if (!clip) return;
    if (listenMode === mode) return stopPreview();
    if (mode === "song") playSongFrom(0, "song", null);
    else if (mode === "clip") playSongFrom(clip.startMs, "clip", clip.endMs);
    else playSongFrom(Math.max(clip.startMs, clip.endMs - 5000), "ending", clip.endMs);
  }

  /**
   * Plays the original song from a point, with the playhead moving across the
   * waveform; stops by itself at `until` if given. Already playing: jumps there.
   * (A tap on the waveform plays the song from that point.)
   */
  function playSongFrom(ms: number, mode: "song" | "clip" | "ending" = "song", until: number | null = null) {
    if (!clip) return;
    unlockAudio();
    stopAt.current = until;
    setListenMode(mode);
    const playing = wholeAudio.current;
    if (playing) {
      playing.currentTime = ms / 1000;
      setPlayheadMs(ms);
      return;
    }
    stopPreview();
    setListenMode(mode);
    stopAt.current = until;
    const a = new Audio(`/api/media/songs/${clip.song.id}.mp3`);
    // Through the same bass, treble, volume and gain as the clip, so the sliders are heard here too.
    const tone = toneChain({ volume: clip.volume, gainDb: clip.gainDb, bassDb: clip.bassDb, trebleDb: clip.trebleDb });
    context().createMediaElementSource(a).connect(tone.input);
    listenTone.current = tone;
    a.currentTime = ms / 1000;
    // Safari can ignore a jump made before the song has loaded: make it again once it has.
    if (ms > 0) a.addEventListener("loadedmetadata", () => (a.currentTime = ms / 1000), { once: true });
    setPlayheadMs(ms);
    wholeAudio.current = a;
    a.onended = () => {
      if (wholeAudio.current === a) stopPreview();
    };
    a.play().catch((err) => {
      if (wholeAudio.current !== a || (err as Error).name === "AbortError") return;
      stopPreview();
      setError(`The song didn't play. ${(err as Error).message}`);
    });
    const tick = () => {
      if (wholeAudio.current !== a) return;
      const now = a.currentTime * 1000;
      if (stopAt.current !== null && now >= stopAt.current) return stopPreview();
      setPlayheadMs(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Sets the clip's start, kept inside the song and at least a second before the end. */
  function setStart(ms: number) {
    if (!clip) return;
    const start = Math.round(Math.max(0, Math.min(ms, clip.endMs - CLIP_LIMITS.minLengthMs, clip.song.durationMs)));
    change({ startMs: start, endMs: Math.min(clip.endMs, start + CLIP_LIMITS.maxLengthMs) });
  }

  /** Sets the clip's end, kept inside the song and at least a second after the start. */
  function setEnd(ms: number) {
    if (!clip) return;
    const end = Math.round(Math.min(clip.song.durationMs, Math.max(ms, clip.startMs + CLIP_LIMITS.minLengthMs)));
    change({ endMs: end, startMs: Math.max(clip.startMs, end - CLIP_LIMITS.maxLengthMs) });
  }

  /** Moves the clip's start to where the playhead is (keeping the clip's length if the end would come first). */
  function startHere() {
    if (!clip || playheadMs == null) return;
    const start = Math.round(Math.max(0, Math.min(playheadMs, clip.song.durationMs - CLIP_LIMITS.minLengthMs)));
    let end = clip.endMs;
    if (end - start < CLIP_LIMITS.minLengthMs) end = Math.min(clip.song.durationMs, start + (clip.endMs - clip.startMs));
    end = Math.min(end, start + CLIP_LIMITS.maxLengthMs);
    change({ startMs: start, endMs: end }, true);
  }

  /** Moves the clip's end to where the playhead is (keeping the clip's length if the start would come after it). */
  function endHere() {
    if (!clip || playheadMs == null) return;
    const end = Math.round(Math.min(clip.song.durationMs, Math.max(playheadMs, CLIP_LIMITS.minLengthMs)));
    let start = clip.startMs;
    if (end - start < CLIP_LIMITS.minLengthMs) start = Math.max(0, end - (clip.endMs - clip.startMs));
    start = Math.max(start, end - CLIP_LIMITS.maxLengthMs);
    change({ startMs: start, endMs: end }, true);
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
                  onSeek={(ms) => playSongFrom(ms)}
                />
              ) : (
                <div className="waveform" />
              )}
              {/* [ and ] set the start or end where the playhead is; −.1 / +.1 fine-tune; the times can be typed. */}
              <div className="nudge">
                <div>
                  <button
                    className="bracket-button"
                    aria-label="Start here"
                    title="Start here"
                    disabled={playheadMs == null}
                    onClick={startHere}
                  >
                    <ClipStartIcon />
                  </button>
                  <button aria-label="Start earlier" onClick={() => setStart(clip.startMs - NUDGE_MS)}>
                    −.1
                  </button>
                  <TimeBox label="Clip start" ms={clip.startMs} onCommit={setStart} />
                  <button aria-label="Start later" onClick={() => setStart(clip.startMs + NUDGE_MS)}>
                    +.1
                  </button>
                </div>
                {/* Where the playhead is (while something plays): what the brackets would use. */}
                <span className={`playhead-box${playheadMs == null ? " idle" : ""}`} aria-label="Playhead position" role="status">
                  {playheadMs == null ? "–:––.–" : formatTime(playheadMs)}
                </span>
                <div>
                  <button aria-label="End earlier" onClick={() => setEnd(clip.endMs - NUDGE_MS)}>
                    −.1
                  </button>
                  <TimeBox label="Clip end" ms={clip.endMs} onCommit={setEnd} />
                  <button aria-label="End later" onClick={() => setEnd(clip.endMs + NUDGE_MS)}>
                    +.1
                  </button>
                  <button
                    className="bracket-button"
                    aria-label="End here"
                    title="End here"
                    disabled={playheadMs == null}
                    onClick={endHere}
                  >
                    <ClipEndIcon />
                  </button>
                </div>
              </div>
              <div className="row clip-capture">
                {(
                  [
                    { mode: "song", label: "Play the whole song", icon: <SongPlayIcon /> },
                    { mode: "clip", label: "Play the clip from its start", icon: <ClipPlayIcon /> },
                    { mode: "ending", label: "Play the clip's last 5 seconds", icon: <ClipEndingPlayIcon /> },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.mode}
                    className={`icon-button${listenMode === b.mode ? " on" : ""}`}
                    aria-label={listenMode === b.mode ? "Stop" : b.label}
                    title={b.label}
                    onClick={() => toggleListen(b.mode)}
                  >
                    {listenMode === b.mode ? <StopIcon /> : b.icon}
                  </button>
                ))}
                <span className="grow" />
                <span className="clip-length">{((clip.endMs - clip.startMs) / 1000).toFixed(1)} s clip</span>
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
          onListen={() => listen()}
          onRemake={() => listen(true)}
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
  onRemake(): void;
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
          {player.announcement && (
            <div className="row" style={{ gap: 10 }}>
              <span className="muted small grow">
                Each take comes out a little different. A stray laugh or noise in this one? Make a new take (uses a few credits).
              </span>
              <button className="small-button" onClick={props.onRemake} disabled={props.listening}>
                Remake
              </button>
            </div>
          )}
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

/** "1:23.4" or "83.4" (seconds) → milliseconds; null if it isn't a time. */
function parseTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d*)?)\s*$/.exec(text);
  if (!m) return null;
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000);
}

/** A clip time you can also type ("1:23.4" or seconds); applied on Enter or leaving the box. */
function TimeBox({ label, ms, onCommit }: { label: string; ms: number; onCommit(ms: number): void }) {
  const [text, setText] = useState<string | null>(null); // null: not being edited, show the clip's time
  const commit = () => {
    if (text === null) return;
    const value = parseTime(text);
    if (value !== null && value !== ms) onCommit(value);
    setText(null);
  };
  return (
    <input
      className="time"
      aria-label={label}
      inputMode="decimal"
      value={text ?? formatTime(ms)}
      onFocus={(e) => {
        setText(formatTime(ms));
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
