import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { context, Playback, unlockAudio } from "../audio/engine.ts";
import { CheckIcon } from "./Icons.tsx";
import {
  STYLE_LIMITS,
  formatCues,
  splitCues,
  type AnnouncerCredits,
  type AnnouncerStyle,
  type AnnouncerVoice as Voice,
  type VoiceFilters as Filters,
  type Energy,
  type VoiceEngine,
} from "../../shared/types.ts";
import { useLockPageScroll } from "../lockScroll.ts";

/** What the server says about the announcer: the engines set up, the one in use, and its voices. */
export interface AnnouncerEngineInfo {
  engine: VoiceEngine | null;
  engines: { id: VoiceEngine; label: string }[];
  /** Which delivery settings the engine can use. */
  controls: { speed: boolean; pitch: boolean };
  voices: Voice[];
  error: string | null;
}

/**
 * A team's announcer voice and delivery: the Delivery card (cues, energy,
 * range, echo…) with Listen, and the voice list with filters. The team
 * editor saves the changes; Listen tries them out before they're saved.
 */
export function AnnouncerSettings(props: {
  /** The team's voice and delivery as saved. */
  voice: string;
  style: AnnouncerStyle;
  /**
   * The team's wording as it is in the box (maybe not saved yet), so Listen says
   * exactly what's typed, and as saved. It's saved with the delivery.
   */
  template: string;
  savedTemplate: string;
  onVoice(voice: string): Promise<void>;
  /** Saves the wording and delivery together (one remake); returns the delivery as saved. */
  onSave(changes: { style?: AnnouncerStyle; template?: string }): Promise<AnnouncerStyle>;
}) {
  const { voice: current } = props;
  const [info, setInfo] = useState<AnnouncerEngineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  /** Delivery settings being tried out; saved with "Use these settings". */
  const [style, setStyle] = useState<AnnouncerStyle>(props.style);
  const [savedNote, setSavedNote] = useState(false);
  // Male voices first, since they suit a stadium announcer; change the filters to see others.
  const [filters, setFilters] = useState<Filters>({ gender: "Male" });
  /** The full voice list opens in a sheet; the page shows only the voice in use. */
  const [choosing, setChoosing] = useState(false);
  /** This month's voice-service credits (ElevenLabs only), shown under Listen. */
  const [credits, setCredits] = useState<AnnouncerCredits | null>(null);
  const loadCredits = () =>
    api<{ credits: AnnouncerCredits | null }>("/announcer/credits")
      .then((r) => setCredits(r.credits))
      .catch(() => {});
  const playback = useRef<Playback | null>(null);

  useEffect(() => {
    api<AnnouncerEngineInfo>("/announcer")
      .then(setInfo)
      .catch((err) => setError(err.message));
    void loadCredits();
  }, []);

  // A fresh copy from the server (another editor, or the saved, tidied cues) replaces the draft.
  useEffect(() => setStyle(props.style), [JSON.stringify(props.style)]); // eslint-disable-line react-hooks/exhaustive-deps

  const styleChanged = JSON.stringify(style) !== JSON.stringify(props.style);
  const templateChanged = props.template.trim() !== props.savedTemplate;
  const changed = styleChanged || templateChanged;
  const change = (c: Partial<AnnouncerStyle>) => {
    setStyle((s) => ({ ...s, ...c }));
    setSavedNote(false);
  };

  async function save() {
    setError(null);
    try {
      setStyle(
        await props.onSave({
          ...(styleChanged ? { style } : {}),
          ...(templateChanged ? { template: props.template } : {}),
        }),
      );
      setSavedNote(true);
      window.setTimeout(() => void loadCredits(), 15_000); // once the team's announcements are remade
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function listen(voice: string) {
    unlockAudio(); // must start inside the tap
    playback.current?.stop();
    setPlaying(voice);
    setError(null);
    try {
      const res = await fetch("/api/announcer/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice, style, template: props.template }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The sample didn't play.");
      void loadCredits(); // making the sample used some
      const buffer = await context().decodeAudioData(await res.arrayBuffer());
      const p = new Playback(null, null, { buffer, songDelayMs: 0 });
      playback.current = p;
      p.onEnded = () => setPlaying((v) => (v === voice ? null : v));
    } catch (err) {
      setError((err as Error).message);
      setPlaying(null);
    }
  }

  async function choose(voice: string) {
    try {
      await props.onVoice(voice);
      setChoosing(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const eleven = info?.engine === "elevenlabs";
  const voices = info?.voices ?? [];
  const filterable = voices.some((v) => v.gender || v.accent || v.age);
  const matches = (v: Voice) =>
    !filterable ||
    v.id === current || // the voice in use always shows
    ((!filters.gender || v.gender === filters.gender) &&
      (!filters.accent || v.accent === filters.accent) &&
      (!filters.age || v.age === filters.age));
  const shown = voices.filter(matches);
  const optionsFor = (key: keyof Filters) =>
    [...new Set(voices.map((v) => v[key]).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

  return (
    <>
      {(error || info?.error) && <p className="error" role="alert">{error ?? info?.error}</p>}
      {!info && !error && <p className="muted">Loading…</p>}
      {info && !info.error && (
        <div className="stack" style={{ marginBottom: 10 }}>
          <div className="row">
            <span className="section-title grow" style={{ fontSize: 17 }}>
              Delivery
            </span>
            <button className="small-button" onClick={() => listen(current)} disabled={playing === current}>
              {playing === current ? "…" : "Listen"}
            </button>
          </div>
          {credits && credits.limit > 0 && <CreditsNote credits={credits} />}
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
          {changed && (
            <button className="primary" onClick={save}>
              Use these settings
            </button>
          )}
          {savedNote && !changed && (
            <p className="muted small" style={{ margin: 0 }}>
              <CheckIcon /> Saved. Every announcement is being remade.
            </p>
          )}
        </div>
      )}
      {info && !info.error && (
        <>
          <div className="row" style={{ margin: "10px 0 6px" }}>
            <span className="section-title grow" style={{ fontSize: 17 }}>
              Voice
            </span>
          </div>
          {/* The voice in use, with Listen; the full list opens in a sheet. */}
          <div className="voice-row in-use current-voice">
            <span className="voice-text">
              <span className="voice-name">{voices.find((v) => v.id === current)?.name ?? "Default voice"}</span>
              <span className="voice-detail">{voices.find((v) => v.id === current)?.detail ?? ""}</span>
            </span>
            <button className="compact-button" onClick={() => listen(current)} disabled={playing === current}>
              {playing === current ? "…" : "Listen"}
            </button>
            <button className="compact-button primary" onClick={() => setChoosing(true)}>
              Change voice
            </button>
          </div>
        </>
      )}
      {choosing && (
        <div className="sheet-backdrop" onClick={() => setChoosing(false)}>
          <LockPageScroll />
          <div className="sheet" role="dialog" aria-label="Choose a voice" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <span className="section-title grow">Choose a voice</span>
              <button className="link-button" onClick={() => setChoosing(false)}>
                Close
              </button>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            {filterable && (
              <VoiceFilters
                filters={filters}
                onChange={setFilters}
                options={{ gender: optionsFor("gender"), accent: optionsFor("accent"), age: optionsFor("age") }}
                note={`${shown.length} of ${voices.length} voices`}
              />
            )}
            <div className="sheet-list">
              {/* Compact rows: name and details on one line, small buttons, dividers instead of cards. */}
              <ul className="voice-list">
                {shown.map(({ id, name, detail }) => (
                  <li key={id} className={`voice-row${id === current ? " in-use" : ""}`}>
                    <span className="voice-text">
                      <span className="voice-name">{name}</span>
                      <span className="voice-detail">{detail}</span>
                    </span>
                    {id === current && <span className="tag on-deck-tag">In use</span>}
                    <button className="compact-button" onClick={() => listen(id)} disabled={playing === id}>
                      {playing === id ? "…" : "Listen"}
                    </button>
                    {id !== current && (
                      <button className="compact-button primary" onClick={() => choose(id)}>
                        Use
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {filterable && shown.length === 0 && <p className="empty">No voices match. Try other filters.</p>}
            </div>
          </div>
        </div>
      )}
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


/** Keeps the page behind an open sheet still (a component, so a sheet drawn inline can use it). */
function LockPageScroll() {
  useLockPageScroll();
  return null;
}

/** "28,400 of 30,000 credits left · resets Nov 3", in red when under a tenth is left. */
function CreditsNote({ credits }: { credits: AnnouncerCredits }) {
  const left = Math.max(0, credits.limit - credits.used);
  const low = left < credits.limit / 10;
  const resets = credits.resetsAt
    ? ` · resets ${new Date(credits.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return (
    <span className="small" style={{ color: low ? "var(--danger)" : "var(--muted)", textAlign: "right" }}>
      {left.toLocaleString()} of {credits.limit.toLocaleString()} ElevenLabs credits left{resets}
    </span>
  );
}
