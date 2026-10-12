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
  type LibraryFilters,
  type LibraryVoice,
  type Energy,
  type VoiceEngine,
} from "../../shared/types.ts";

interface AnnouncerInfo {
  engine: VoiceEngine | null;
  engines: { id: VoiceEngine; label: string }[];
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
  // Male voices first, since they suit a stadium announcer; change the filters to see others.
  const [filters, setFilters] = useState<LibraryFilters>({ gender: "Male" });
  /** Delivery settings being tried out; saved with "Use these settings". */
  const [style, setStyle] = useState<AnnouncerStyle>(DEFAULT_STYLE);
  const [savedNote, setSavedNote] = useState(false);
  const current = useRef<Playback | null>(null);

  const load = () =>
    api<AnnouncerInfo>("/announcer")
      .then((r) => {
        setInfo(r);
        setStyle(r.style);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    void load();
  }, []);

  async function switchEngine(id: VoiceEngine) {
    if (id === info?.engine) return;
    setError(null);
    setInfo((i) => i && { ...i, engine: id, voices: [], error: null });
    setFilters({ gender: "Male" }); // each engine starts with its male voices
    try {
      await api("/announcer/engine", { method: "PUT", body: { engine: id } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
  const murf = info?.engine === "murf";
  const eleven = info?.engine === "elevenlabs";
  const voices = info?.voices ?? [];
  // Kokoro and Murf have many voices: male ones first, since they suit a stadium announcer; the rest on request.
  // Murf styles differ per voice. The list offers every style; picking one the voice in use
  // lacks narrows the voices below to those that have it.
  const allStyles = [...new Set(voices.flatMap((v) => v.styles ?? []))].sort((a, b) => a.localeCompare(b));
  const currentVoice = voices.find((v) => v.id === info?.voice);
  const styleFilter = murf && style.murfStyle ? style.murfStyle : "";
  const styleMissing = !!styleFilter && !(currentVoice?.styles ?? []).includes(styleFilter);
  const withStyle = styleFilter ? voices.filter((v) => v.styles?.includes(styleFilter)) : voices;
  const filterable = voices.some((v) => v.gender || v.accent || v.age);
  const matches = (v: Voice) =>
    !filterable ||
    v.id === info?.voice || // the voice in use always shows
    ((!filters.gender || v.gender === filters.gender) &&
      (!filters.accent || v.accent === filters.accent) &&
      (!filters.age || v.age === filters.age));
  const shown = withStyle.filter(matches);
  const optionsFor = (key: keyof LibraryFilters) =>
    [...new Set(voices.map((v) => v[key]).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
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
      {info && info.engines.length > 1 && (
        <div className="segmented" role="radiogroup" aria-label="Voice engine" style={{ marginBottom: 10 }}>
          {info.engines.map((e) => (
            <button
              key={e.id}
              role="radio"
              aria-checked={info.engine === e.id}
              className={info.engine === e.id ? "on" : ""}
              onClick={() => switchEngine(e.id)}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
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
            {murf && (
              <div className="editor-row">
                <span className="label">Style</span>
                <select
                  className="grow"
                  value={style.murfStyle}
                  onChange={(e) => change({ murfStyle: e.target.value })}
                  aria-label="Speaking style"
                >
                  <option value="">Voice's default</option>
                  {allStyles.map((st) => (
                    <option key={st} value={st}>
                      {st}
                      {currentVoice?.styles?.includes(st) ? "" : ` (not ${currentVoice?.name ?? "this voice"})`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {eleven && (
              <>
                <div className="editor-row">
                  <span className="label">Cue</span>
                  <select
                    className="grow"
                    value={ELEVEN_CUES.includes(style.elevenTag) ? style.elevenTag : "custom"}
                    onChange={(e) => change({ elevenTag: e.target.value === "custom" ? "" : e.target.value })}
                    aria-label="Delivery cue"
                  >
                    {ELEVEN_CUES.map((c) => (
                      <option key={c} value={c}>
                        {c ? `[${c}]` : "None"}
                      </option>
                    ))}
                    <option value="custom">Your own…</option>
                  </select>
                </div>
                {!ELEVEN_CUES.includes(style.elevenTag) && (
                  <div className="editor-row">
                    <span className="label">Your cue</span>
                    <input
                      className="grow"
                      value={style.elevenTag}
                      onChange={(e) => change({ elevenTag: e.target.value })}
                      placeholder="e.g. stadium announcer, booming"
                      maxLength={40}
                      aria-label="Your own delivery cue"
                    />
                  </div>
                )}
                <Slider
                  label="Range"
                  aria="Emotional range"
                  min={STYLE_LIMITS.minExcitement}
                  max={STYLE_LIMITS.maxExcitement}
                  step={0.05}
                  value={style.excitement}
                  show={style.excitement >= 1.4 ? "Wild" : style.excitement >= 0.75 ? "Natural" : "Steady"}
                  onChange={(v) => change({ excitement: v })}
                />
              </>
            )}
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
              : murf
                ? "Style changes the voice's delivery; each Murf voice has its own styles (Promo is a good start for announcing). Energy changes the punctuation it reads. "
                : eleven
                  ? "Cue tells the voice how to deliver the line, like an actor's direction; you can write your own. Range sets how much emotion it allows: Wild is the most expressive. "
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
      {styleMissing && (
        <p className="notice">
          {currentVoice?.name ?? "The voice in use"} doesn't have the {styleFilter} style. The voices below do: Listen to
          them, then tap Use.
        </p>
      )}
      {styleFilter && !styleMissing && withStyle.length > 1 && (
        <p className="muted small" style={{ margin: "0 4px 8px" }}>
          Showing the voices that have the {styleFilter} style.
        </p>
      )}
      {filterable && (
        <VoiceFilters
          filters={filters}
          onChange={setFilters}
          options={{ gender: optionsFor("gender"), accent: optionsFor("accent"), age: optionsFor("age") }}
          note={`${shown.length} of ${withStyle.length} voices`}
        />
      )}
      <ul className="list">
        {shown.map(({ id, name, detail, styles }) => (
          <li key={id || "default"} className="list-item">
            <div className="player-row">
              <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="player-name truncate">
                  {name} {id === info?.voice && <span className="tag on-deck-tag">In use</span>}
                </span>
                <span className="muted small">{detail}</span>
                {murf && !styleFilter && styles && styles.length > 0 && (
                  <span className="faint small truncate">{styles.join(", ")}</span>
                )}
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
      {filterable && shown.length === 0 && <p className="empty">No voices match. Try other filters.</p>}
      {info?.canAddVoices && <AddVoice onAdded={(voices) => setInfo((i) => i && { ...i, voices })} />}
      {eleven && <VoiceLibrary onAdded={(voices) => setInfo((i) => i && { ...i, voices })} />}
    </>
  );
}

/** Delivery cues offered for ElevenLabs (written as [cue] before the announcement). */
const ELEVEN_CUES = ["", "excited", "enthusiastic", "shouting", "energetic", "sports announcer", "dramatic"];

/** Search ElevenLabs' shared library and add voices to the account. Previews are free; adding costs nothing. */
function VoiceLibrary({ onAdded }: { onAdded(voices: Voice[]): void }) {
  const [query, setQuery] = useState("sports announcer");
  const [filters, setFilters] = useState<LibraryFilters>({ gender: "Male", accent: "American" });
  const [results, setResults] = useState<LibraryVoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const preview = useRef<HTMLAudioElement | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      setResults((await api<{ voices: LibraryVoice[] }>(`/announcer/library?${params}`)).voices);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function play(url: string) {
    preview.current?.pause();
    preview.current = new Audio(url);
    void preview.current.play().catch(() => setError("The preview didn't play."));
  }

  async function add(v: LibraryVoice) {
    setError(null);
    try {
      const r = await api<{ voices: Voice[] }>("/announcer/library", {
        method: "POST",
        body: { ownerId: v.ownerId, voiceId: v.id, name: v.name },
      });
      setAdded((a) => [...a, v.id]);
      onAdded(r.voices);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card stack" style={{ marginTop: 10 }}>
      <span style={{ fontWeight: 800 }}>Find more voices</span>
      <p className="muted small" style={{ margin: 0 }}>
        Search ElevenLabs' library of voices people have shared. Preview is free; Add puts the voice in the list above.
      </p>
      <div className="row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="e.g. sports announcer, deep male"
          aria-label="Search the voice library"
        />
        <button className="small-button" onClick={search} disabled={busy} style={{ minHeight: 48 }}>
          {busy ? "…" : "Search"}
        </button>
      </div>
      <VoiceFilters filters={filters} onChange={setFilters} options={LIBRARY_OPTIONS} />
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {results?.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing found. Try other words or filters.</p>}
      <ul className="list">
        {results?.map((v) => (
          <li key={v.id} className="list-item">
            <div className="player-row">
              <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <span className="player-name truncate">{v.name}</span>
                <span className="muted small truncate">{v.detail}</span>
              </span>
              {v.previewUrl && (
                <button className="small-button" onClick={() => play(v.previewUrl!)}>
                  Preview
                </button>
              )}
              {added.includes(v.id) ? (
                <span className="muted small">
                  <CheckIcon /> Added
                </span>
              ) : (
                <button className="small-button primary" onClick={() => add(v)}>
                  Add
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Filter choices for ElevenLabs' library (its own labels, shown in our words). */
const LIBRARY_OPTIONS = {
  gender: ["Male", "Female"],
  accent: ["American", "Australian", "British", "Canadian", "Irish", "Scottish"],
  age: ["Young", "Middle-aged", "Older"],
};

/** Gender / accent / age dropdowns ("Any" = no filter). */
function VoiceFilters(props: {
  filters: LibraryFilters;
  onChange(f: LibraryFilters): void;
  options: Record<keyof LibraryFilters, string[]>;
  note?: string;
}) {
  const labels: Record<keyof LibraryFilters, string> = { gender: "Gender", accent: "Accent", age: "Age" };
  return (
    <div className="voice-filters">
      {(Object.keys(labels) as (keyof LibraryFilters)[])
        .filter((k) => props.options[k].length > 0)
        .map((k) => (
          <select
            key={k}
            value={props.filters[k] ?? ""}
            onChange={(e) => props.onChange({ ...props.filters, [k]: e.target.value || undefined })}
            aria-label={labels[k]}
          >
            <option value="">Any {labels[k].toLowerCase()}</option>
            {props.options[k].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ))}
      {props.note && <span className="muted small">{props.note}</span>}
    </div>
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
