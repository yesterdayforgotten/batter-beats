import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, upload } from "../api.ts";
import { context, Playback, unlockAudio } from "../audio/engine.ts";
import { CheckIcon, ChevronIcon } from "../components/Icons.tsx";
import {
  DEFAULT_STYLE,
  STYLE_LIMITS,
  type AnnouncerStyle,
  type AnnouncerVoice as Voice,
  type Energy,
  type VoiceEngine,
} from "../../shared/types.ts";

interface AnnouncerInfo {
  engine: VoiceEngine;
  canAddVoices: boolean;
  voice: string;
  style: AnnouncerStyle;
  voices: Voice[];
  error: string | null;
}

export function AdminPage() {
  return (
    <section>
      <h1 className="big-title">Admin</h1>
      <ul className="list">
        <li className="list-item">
          <Link to="/admin/users">
            <span className="stack grow" style={{ gap: 2 }}>
              <span className="player-name">Users</span>
              <span className="muted small">Add people, set roles, reset passwords</span>
            </span>
            <span className="muted">
              <ChevronIcon />
            </span>
          </Link>
        </li>
      </ul>
      <AnnouncerVoice />
      <Backup />
    </section>
  );
}

function AnnouncerVoice() {
  const [info, setInfo] = useState<AnnouncerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  /** Delivery settings being tried out; saved with "Use these settings". */
  const [style, setStyle] = useState<AnnouncerStyle>(DEFAULT_STYLE);
  const [savedNote, setSavedNote] = useState(false);
  const current = useRef<Playback | null>(null);

  useEffect(() => {
    api<AnnouncerInfo>("/announcer")
      .then((r) => {
        setInfo(r);
        setStyle(r.style);
      })
      .catch((err) => setError(err.message));
  }, []);

  const styleChanged = !!info && JSON.stringify(style) !== JSON.stringify(info.style);
  const change = (c: Partial<AnnouncerStyle>) => {
    setStyle((s) => ({ ...s, ...c }));
    setSavedNote(false);
  };

  async function saveStyle() {
    try {
      const r = await api<{ style: AnnouncerStyle }>("/announcer/style", { method: "PUT", body: style });
      setInfo((i) => i && { ...i, style: r.style });
      setStyle(r.style);
      setSavedNote(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function listen(voice: string) {
    unlockAudio(); // must start inside the tap
    current.current?.stop();
    setPlaying(voice);
    setError(null);
    try {
      const res = await fetch("/api/announcer/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice, style }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The sample didn't play.");
      const buffer = await context().decodeAudioData(await res.arrayBuffer());
      const p = new Playback(null, null, { buffer, songDelayMs: 0 });
      current.current = p;
      p.onEnded = () => setPlaying((v) => (v === voice ? null : v));
    } catch (err) {
      setError((err as Error).message);
      setPlaying(null);
    }
  }

  async function choose(voice: string) {
    try {
      await api("/announcer/voice", { method: "PUT", body: { voice } });
      setInfo((i) => i && { ...i, voice });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const chatterbox = info?.engine === "chatterbox";
  const voices = info?.voices ?? [];
  // Kokoro has many voices: male ones first, since they suit a stadium announcer; the rest on request.
  const shown =
    chatterbox || showAll ? voices : voices.filter((v) => v.detail.endsWith("· male") || v.id === info?.voice);
  const slow = chatterbox ? " Without a graphics card each one can take a minute." : "";

  return (
    <>
      <div className="section-title" style={{ margin: "26px 4px 8px" }}>
        Announcer voice
      </div>
      <p className="muted small" style={{ margin: "0 4px 10px" }}>
        Listen to "Now batting, number 12, Alex Rivera" in each voice. Choosing a voice or delivery remakes every
        announcement in the background.{slow}
      </p>
      {(error || info?.error) && <p className="error">{error ?? info?.error}</p>}
      {!info && !error && <p className="muted">Loading…</p>}
      {info && !info.error && (
        <div className="card stack" style={{ marginBottom: 10 }}>
          <div className="row">
            <span className="section-title grow">Delivery</span>
            <button className="small-button" onClick={() => listen(info.voice)} disabled={playing === info.voice}>
              {playing === info.voice ? "…" : "Listen"}
            </button>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Energy">
            {(["calm", "lively", "hyped"] as Energy[]).map((e) => (
              <button
                key={e}
                role="radio"
                aria-checked={style.energy === e}
                className={style.energy === e ? "on" : ""}
                onClick={() => change({ energy: e })}
              >
                {{ calm: "Calm", lively: "Lively", hyped: "Hyped" }[e]}
              </button>
            ))}
          </div>
          <div className="editor-rows" style={{ padding: 0 }}>
            {chatterbox && (
              <>
                <Slider
                  label="Excite"
                  aria="Excitement"
                  min={STYLE_LIMITS.minExcitement}
                  max={STYLE_LIMITS.maxExcitement}
                  step={0.05}
                  value={style.excitement}
                  show={style.excitement.toFixed(2)}
                  onChange={(v) => change({ excitement: v })}
                />
                <Slider
                  label="Pace"
                  aria="Pace"
                  min={0}
                  max={1}
                  step={0.05}
                  value={style.pace}
                  show={style.pace < 0.3 ? "Slow" : style.pace > 0.6 ? "Quick" : "Steady"}
                  onChange={(v) => change({ pace: v })}
                />
              </>
            )}
            <Slider
              label="Speed"
              aria="Speed"
              min={STYLE_LIMITS.minSpeed}
              max={STYLE_LIMITS.maxSpeed}
              step={0.05}
              value={style.speed}
              show={`${style.speed.toFixed(2)}×`}
              onChange={(v) => change({ speed: v })}
            />
            <Slider
              label="Pitch"
              aria="Pitch lift"
              min={0}
              max={STYLE_LIMITS.maxPitch}
              step={0.5}
              value={style.pitch}
              show={style.pitch === 0 ? "Normal" : `+${style.pitch}`}
              onChange={(v) => change({ pitch: v })}
            />
            <Slider
              label="Reverb"
              aria="Reverb amount"
              min={0}
              max={1}
              step={0.05}
              value={style.reverb}
              show={style.reverb === 0 ? "Off" : `${Math.round(style.reverb * 100)}%`}
              onChange={(v) => change({ reverb: v })}
            />
            {style.reverb > 0 && (
              <Slider
                label="Space"
                aria="Reverb size"
                min={0}
                max={1}
                step={0.05}
                value={style.reverbSize}
                show={style.reverbSize < 0.34 ? "Room" : style.reverbSize < 0.67 ? "Gym" : "Ballpark"}
                onChange={(v) => change({ reverbSize: v })}
              />
            )}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {chatterbox
              ? "Excite is the voice engine's emotion dial: higher sounds more dramatic. For a big stadium read, try Excite above 1 with a slow Pace. "
              : "This voice engine has no emotion setting, so Energy changes the punctuation it reads, which changes how it's read. "}
            Reverb adds the echo of a big space; Space sets how big. Listen to try a mix; the Listen buttons below use it
            too.
          </p>
          {styleChanged && (
            <button className="primary" onClick={saveStyle}>
              Use these settings
            </button>
          )}
          {savedNote && !styleChanged && (
            <p className="muted small" style={{ margin: 0 }}>
              <CheckIcon /> Saved. Every announcement is being remade.
            </p>
          )}
        </div>
      )}
      <ul className="list">
        {shown.map(({ id, name, detail }) => (
          <li key={id || "default"} className="list-item">
            <div className="player-row">
              <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="player-name truncate">
                  {name} {id === info?.voice && <span className="tag on-deck-tag">In use</span>}
                </span>
                <span className="muted small">{detail}</span>
              </span>
              <button className="small-button" onClick={() => listen(id)} disabled={playing === id}>
                {playing === id ? "…" : "Listen"}
              </button>
              {id !== info?.voice && (
                <button className="small-button primary" onClick={() => choose(id)}>
                  Use
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!chatterbox && voices.length > shown.length && (
        <button className="link-button" style={{ marginTop: 6 }} onClick={() => setShowAll(true)}>
          Show all {voices.length} English voices
        </button>
      )}
      {info?.canAddVoices && <AddVoice onAdded={(voices) => setInfo((i) => i && { ...i, voices })} />}
    </>
  );
}

function Slider(props: {
  label: string;
  aria: string;
  min: number;
  max: number;
  step: number;
  value: number;
  show: string;
  onChange(v: number): void;
}) {
  return (
    <div className="editor-row">
      <span className="label">{props.label}</span>
      <input
        type="range"
        className="grow"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-label={props.aria}
      />
      <span className="value">{props.show}</span>
    </div>
  );
}

/** Teach the voice engine a new voice from 10–30 seconds of someone speaking. */
function AddVoice({ onAdded }: { onAdded(voices: Voice[]): void }) {
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function add(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const r = await upload<{ voices: Voice[] }>("/announcer/voices", file, setProgress, { name });
      onAdded(r.voices);
      setName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="card stack" style={{ marginTop: 10 }}>
      <span style={{ fontWeight: 800 }}>Add a voice from a recording</span>
      <p className="muted small" style={{ margin: 0 }}>
        10 to 30 seconds of one person speaking clearly, with no music behind them (MP3, WAV or M4A). A recording of a
        stadium announcer, or someone doing the voice, gives the announcer that style.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Ballpark Bob" maxLength={60} aria-label="Voice name" />
      <button disabled={!name.trim() || progress !== null} onClick={() => fileInput.current?.click()}>
        {progress === null ? "Choose the recording…" : progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Learning the voice…"}
      </button>
      <input ref={fileInput} type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => add(e.target.files?.[0])} />
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}

function Backup() {
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function restore(file: File | undefined) {
    if (!file) return;
    if (fileInput.current) fileInput.current.value = "";
    if (
      !confirm(
        `Replace everything (teams, players, songs, users, playlists) with the backup in "${file.name}"? Everything here now is replaced.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setProgress(0);
    try {
      await upload("/admin/restore", file, setProgress);
      setMessage("Restored. Reloading…");
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <div className="section-title" style={{ margin: "26px 4px 8px" }}>
        Backup
      </div>
      <div className="card stack">
        <p className="muted small" style={{ margin: 0 }}>
          One file with everything: teams, players, songs, clips, announcements, users and playlists. Keep it somewhere
          safe, off this server.
        </p>
        <a className="button-link primary" href="/api/admin/backup" download>
          Download backup
        </a>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Restoring replaces everything with what's in a backup file. People may need to sign in again afterwards.
        </p>
        <button disabled={progress !== null} onClick={() => fileInput.current?.click()}>
          {progress === null
            ? "Restore from a backup…"
            : progress < 1
              ? `Uploading… ${Math.round(progress * 100)}%`
              : "Restoring…"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".tar,application/x-tar"
          style={{ display: "none" }}
          onChange={(e) => restore(e.target.files?.[0])}
        />
        {message && (
          <p className="muted" style={{ margin: 0 }}>
            <CheckIcon /> {message}
          </p>
        )}
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </div>
    </>
  );
}
