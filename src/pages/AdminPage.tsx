import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, upload } from "../api.ts";
import { context, Playback, unlockAudio } from "../audio/engine.ts";
import { CheckIcon, ChevronIcon } from "../components/Icons.tsx";
import {
  DEFAULT_STYLE,
  STYLE_LIMITS,
  splitCues,
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
  /** Which delivery settings the engine can use. */
  controls: { speed: boolean; pitch: boolean };
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
  /** Delivery settings being tried out; saved with "Use these settings". */
  const [style, setStyle] = useState<AnnouncerStyle>(DEFAULT_STYLE);
  const [savedNote, setSavedNote] = useState(false);
  // Male voices first, since they suit a stadium announcer; change the filters to see others.
  const [filters, setFilters] = useState<LibraryFilters>({ gender: "Male" });
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

  const eleven = info?.engine === "elevenlabs";
  const voices = info?.voices ?? [];
  const filterable = voices.some((v) => v.gender || v.accent || v.age);
  const matches = (v: Voice) =>
    !filterable ||
    v.id === info?.voice || // the voice in use always shows
    ((!filters.gender || v.gender === filters.gender) &&
      (!filters.accent || v.accent === filters.accent) &&
      (!filters.age || v.age === filters.age));
  const shown = voices.filter(matches);
  const optionsFor = (key: keyof LibraryFilters) =>
    [...new Set(voices.map((v) => v[key]).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

  return (
    <>
      <div className="section-title" style={{ margin: "26px 4px 8px" }}>
        Announcer voice
      </div>
      <p className="muted small" style={{ margin: "0 4px 10px" }}>
        Listen to "Now batting, number 12, Alex Rivera" in each voice. Choosing a voice or delivery remakes every
        announcement in the background.
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
            {eleven && (
              <>
                <CueInput value={style.elevenTag} onChange={(elevenTag) => change({ elevenTag })} />
                {/* ElevenLabs v3 has exactly three settings here (Robust, Natural, Creative), so three buttons, not a slider. */}
                <div className="editor-row">
                  <span className="label">Range</span>
                  <div className="segmented grow" role="radiogroup" aria-label="Emotional range">
                    {RANGES.map((r) => (
                      <button
                        key={r.label}
                        role="radio"
                        aria-checked={rangeOf(style.excitement) === r.label}
                        className={rangeOf(style.excitement) === r.label ? "on" : ""}
                        onClick={() => change({ excitement: r.value })}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {info.controls.speed && (
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
            )}
            {info.controls.pitch && (
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
            )}
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
            {eleven
              ? "Cue tells the voice how to deliver the line, like an actor's direction: write anything, several separated by commas, or tap in the box for suggestions (for pace, try \"speaking quickly\"). Range sets how much emotion it allows: Wild is the most expressive. "
              : "This voice engine has no emotion setting, so Energy changes the punctuation it reads, which changes how it's read. "}
            Reverb adds the echo of a big space; Space sets how big. A real ballpark's speakers add their own echo, so
            go easy. Listen to try a mix; the Listen buttons below use it too.
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
      {filterable && (
        <VoiceFilters
          filters={filters}
          onChange={setFilters}
          options={{ gender: optionsFor("gender"), accent: optionsFor("accent"), age: optionsFor("age") }}
          note={`${shown.length} of ${voices.length} voices`}
        />
      )}
      <ul className="list">
        {shown.map(({ id, name, detail }) => (
          <li key={id} className="list-item">
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
      {filterable && shown.length === 0 && <p className="empty">No voices match. Try other filters.</p>}
      {eleven && <VoiceLibrary onAdded={(voices) => setInfo((i) => i && { ...i, voices })} />}
    </>
  );
}

/**
 * ElevenLabs' three emotional ranges, stored on the excitement scale the
 * server maps to v3 stability (see elevenStability in server/voiceEngines.ts).
 */
const RANGES = [
  { label: "Steady", value: 0.5 },
  { label: "Natural", value: 1 },
  { label: "Wild", value: 1.5 },
] as const;
const rangeOf = (excitement: number) => (excitement >= 1.4 ? "Wild" : excitement >= 0.75 ? "Natural" : "Steady");

/** Suggested ElevenLabs delivery cues (any words work; each is written as [cue] before the announcement). */
const CUE_SUGGESTIONS = [
  "excited",
  "enthusiastic",
  "energetic",
  "shouting",
  "dramatic",
  "sports announcer",
  "stadium PA announcer",
  "booming",
  "speaking quickly",
  "slow build-up",
  "proud",
];

/**
 * The ElevenLabs cues: free text, several separated by commas, with
 * suggestions shown while the box is in use or hovered (phones have no
 * hover, so tapping in shows them too). Tapping a suggestion adds it, or
 * takes it out if it's already there.
 */
function CueInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const cues = splitCues(value);
  const has = (c: string) => cues.some((x) => x.toLowerCase() === c.toLowerCase());
  const toggle = (c: string) =>
    onChange((has(c) ? cues.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...cues, c]).join(", "));
  return (
    <div className="editor-row cue-row" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="label">Cue</span>
      <div className="cue-field grow">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          // Close only after the tap that moved focus away has landed: closing at once would
          // shift everything below up mid-tap, so the tap would hit something else.
          onBlur={() => window.setTimeout(() => setOpen(false), 250)}
          placeholder="How to say it, e.g. excited, booming"
          maxLength={200}
          aria-label="Delivery cue"
          title={`Separate several with commas. Suggestions: ${CUE_SUGGESTIONS.join(", ")}`}
        />
        {(open || hover) && (
          <div className="cue-suggestions" role="listbox" aria-multiselectable="true" aria-label="Suggested cues">
            <span className="muted small cue-hint">Tap to add or remove. Up to 5, separated by commas.</span>
            {CUE_SUGGESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={has(c)}
                className={has(c) ? "on" : ""}
                // Keep the box focused so the list stays open while choosing several.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
