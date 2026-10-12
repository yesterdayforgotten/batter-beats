import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, upload } from "../api.ts";
import { context, Playback, unlockAudio } from "../audio/engine.ts";
import { CheckIcon, ChevronIcon } from "../components/Icons.tsx";
import {
  DEFAULT_STYLE,
  STYLE_LIMITS,
  formatCues,
  splitCues,
  type AnnouncerStyle,
  type AnnouncerVoice as Voice,
  type VoiceFilters as Filters,
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
  const [filters, setFilters] = useState<Filters>({ gender: "Male" });
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
  const optionsFor = (key: keyof Filters) =>
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
          <div className="editor-rows" style={{ padding: 0 }}>
            {eleven && (
              <CueInput value={style.elevenTag} onChange={(elevenTag) => change({ elevenTag })} help={HELP.cue} />
            )}
            {/* Energy changes the punctuation the voice reads (see withEnergy in server/announcer.ts). */}
            <Slider
              label="Energy"
              aria="Energy"
              help={eleven ? HELP.energy : HELP.energyKokoro}
              min={0}
              max={ENERGIES.length - 1}
              step={1}
              value={Math.max(0, ENERGIES.findIndex((e) => e.value === style.energy))}
              show={ENERGIES.find((e) => e.value === style.energy)?.label ?? "Lively"}
              onChange={(i) => change({ energy: ENERGIES[i].value })}
            />
            {eleven && (
              // ElevenLabs has exactly three settings here (Robust, Natural, Creative), so the slider has three stops.
              <Slider
                label="Range"
                aria="Emotional range"
                help={HELP.range}
                min={0}
                max={RANGES.length - 1}
                step={1}
                value={RANGES.findIndex((r) => r.label === rangeOf(style.excitement))}
                show={rangeOf(style.excitement)}
                onChange={(i) => change({ excitement: RANGES[i].value })}
              />
            )}
            {info.controls.speed && (
              <Slider
                label="Speed"
                aria="Speed"
                help={HELP.speed}
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
                help={HELP.pitch}
                min={0}
                max={STYLE_LIMITS.maxPitch}
                step={0.5}
                value={style.pitch}
                show={style.pitch === 0 ? "Normal" : `+${style.pitch}`}
                onChange={(v) => change({ pitch: v })}
              />
            )}
            <Slider
              label="Echo"
              aria="Stadium echo amount"
              help={HELP.echo}
              min={0}
              max={1}
              step={0.05}
              value={style.reverb}
              show={style.reverb === 0 ? "Off" : `${Math.round(style.reverb * 100)}%`}
              onChange={(v) => change({ reverb: v })}
            />
            {style.reverb > 0 && (
              <Slider
                label="Distance"
                aria="Stadium echo distance"
                help={HELP.distance}
                min={0}
                max={DISTANCES.length - 1}
                step={1}
                value={distanceIndex(style.reverbSize)}
                show={DISTANCES[distanceIndex(style.reverbSize)].label}
                onChange={(i) => change({ reverbSize: DISTANCES[i].value })}
              />
            )}
          </div>
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
    </>
  );
}

/**
 * ElevenLabs' three emotional ranges, stored on the excitement scale the
 * server maps to ElevenLabs stability (see elevenStability in server/voiceEngines.ts).
 */
const RANGES = [
  { label: "Steady", value: 0.5 },
  { label: "Natural", value: 1 },
  { label: "Wild", value: 1.5 },
] as const;
/** The echo distances offered: three stops on the Distance slider. */
const DISTANCES = [
  { label: "Small field", value: 0 },
  { label: "Ballpark", value: 0.5 },
  { label: "Stadium", value: 1 },
] as const;
const distanceIndex = (size: number) => (size < 0.34 ? 0 : size < 0.67 ? 1 : 2);

const rangeOf = (excitement: number) => (excitement >= 1.4 ? "Wild" : excitement >= 0.75 ? "Natural" : "Steady");

/** Suggested ElevenLabs delivery cues (any words work; each is written as [cue] before the announcement). */
// Emotion and delivery words: in tests (Adam, Brian; v3 and v4) these changed the delivery,
// [shouting] most of all on v4, while descriptions like "stadium PA announcer" did little.
// Pace: on v4 [slowly] made speech ~20% longer and [speaking quickly] ~10% shorter (the API's
// speed setting is ignored). [booming] and [with emphasis] were added at the owner's request, untested.
const CUE_SUGGESTIONS = [
  "shouting",
  "excited",
  "booming",
  "with emphasis",
  "enthusiastic",
  "proud",
  "dramatic",
  "speaking quickly",
  "slowly",
];

/**
 * The ElevenLabs cues: free text, each in [square brackets], with
 * suggestions floating over the settings below while the box is selected.
 * Tapping a suggestion adds it, or takes it out if it's already there.
 */
function CueInput({ value, onChange, help }: { value: string; onChange(v: string): void; help?: string }) {
  const [open, setOpen] = useState(false);
  const cues = splitCues(value);
  const has = (c: string) => cues.some((x) => x.toLowerCase() === c.toLowerCase());
  const toggle = (c: string) =>
    onChange(formatCues(has(c) ? cues.filter((x) => x.toLowerCase() !== c.toLowerCase()) : [...cues, c]));
  return (
    <div className="editor-row cue-row">
      <SettingLabel label="Cue" help={help} />
      <div className="cue-field grow">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          // Close only after the tap that moved focus away has landed: closing at once would
          // shift everything below up mid-tap, so the tap would hit something else.
          onBlur={() => {
            // Show what was typed the way ElevenLabs gets it: "shouting, excited" becomes "[shouting] [excited]".
            if (value.trim()) onChange(formatCues(cues));
            setOpen(false);
          }}
          placeholder="e.g. [shouting] [excited]"
          maxLength={200}
          aria-label="Delivery cue"
          title={`Each cue in square brackets. Suggestions: ${formatCues(CUE_SUGGESTIONS)}`}
        />
        {open && (
          <div className="cue-suggestions" role="listbox" aria-multiselectable="true" aria-label="Suggested cues">
            <span className="muted small cue-hint">Tap to add or remove. Up to 5, each in [square brackets].</span>
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
                [{c}]
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Gender / accent / age dropdowns ("Any" = no filter). */
function VoiceFilters(props: {
  filters: Filters;
  onChange(f: Filters): void;
  options: Record<keyof Filters, string[]>;
  note?: string;
}) {
  const labels: Record<keyof Filters, string> = { gender: "Gender", accent: "Accent", age: "Age" };
  return (
    <div className="voice-filters">
      {(Object.keys(labels) as (keyof Filters)[])
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

/** What each delivery setting does; shown when its name is hovered or tapped. */
const HELP = {
  cue: "How the voice delivers the line, like an actor's direction. Write each cue in [square brackets], or tap in the box for suggestions. Emotion words like [shouting] or [excited] work best.",
  energy: 'Changes the punctuation the voice reads. Calm: "…, Ava." Lively: "…, Ava!" Hyped: "Now batting! Number 12! Ava!"',
  energyKokoro:
    'This voice engine has no emotion setting, so Energy changes the punctuation it reads, which changes how it\'s read. Hyped: "Now batting! Number 12! Ava!"',
  range:
    "How much emotion the voice allows. Steady is the most consistent; Wild is the most expressive, and varies more each time. Cues work best on Natural or Wild.",
  speed: "How fast the voice talks.",
  pitch: "Raises the voice. A little higher sounds more excited; too much sounds processed.",
  echo: "Delayed echoes, like you hear off the stands at a ballpark. A real field's speakers add their own echo, so a little goes a long way.",
  distance: "How far away the echoes come back from: quick ones at a small field, later ones at a big stadium.",
};

/** The three Energy settings, as stops on a slider. */
const ENERGIES: { value: Energy; label: string }[] = [
  { value: "calm", label: "Calm" },
  { value: "lively", label: "Lively" },
  { value: "hyped", label: "Hyped" },
];

/**
 * A setting's name. With help, it's a button: hovering with a mouse or
 * tapping it (phones) shows what the setting does; tapping elsewhere hides it.
 */
function SettingLabel({ label, help }: { label: string; help?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!help) return <span className="label">{label}</span>;
  return (
    <span
      ref={ref}
      className="label setting-label"
      // Hover only for a real mouse: on a phone the tap would open it and the click then close it.
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
    >
      <button type="button" className="label-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        <span className="help-mark" aria-hidden>
          ?
        </span>
      </button>
      {open && (
        <span role="tooltip" className="setting-help">
          {help}
        </span>
      )}
    </span>
  );
}

function Slider(props: {
  label: string;
  aria: string;
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  show: string;
  onChange(v: number): void;
}) {
  return (
    <div className="editor-row">
      <SettingLabel label={props.label} help={props.help} />
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
