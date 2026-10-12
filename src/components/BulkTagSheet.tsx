import { useMemo, useState } from "react";
import { TagEditor } from "./TagEditor.tsx";
import { useLockPageScroll } from "../lockScroll.ts";
import type { Song, TagSuggestions } from "../../shared/types.ts";

/**
 * Bottom sheet for changing the tags of several songs at once: tags to add to
 * all of them, and any of their current tags to remove (tap to mark).
 */
export function BulkTagSheet({
  songs,
  suggestions,
  onApply,
  onClose,
}: {
  songs: Song[];
  suggestions: TagSuggestions;
  onApply(add: string[], remove: string[]): Promise<void>;
  onClose(): void;
}) {
  useLockPageScroll();
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The selected songs' tags, with how many of them have each, most common first. */
  const current = useMemo(() => {
    const counts = new Map<string, { tag: string; n: number }>();
    for (const s of songs) {
      for (const t of s.tags) {
        const k = t.toLowerCase();
        counts.set(k, { tag: counts.get(k)?.tag ?? t, n: (counts.get(k)?.n ?? 0) + 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
  }, [songs]);

  const marked = (t: string) => remove.some((r) => r.toLowerCase() === t.toLowerCase());
  const toggleRemove = (t: string) => setRemove(marked(t) ? remove.filter((r) => r.toLowerCase() !== t.toLowerCase()) : [...remove, t]);
  const count = `${songs.length} ${songs.length === 1 ? "song" : "songs"}`;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await onApply(add, remove);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-label="Edit tags" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <span className="section-title grow">Tags for {count}</span>
          <button className="link-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="sheet-list" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}>
            <TagEditor tags={add} suggestions={suggestions} onChange={setAdd} label="Add to all" />
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="field-label">Remove</span>
            {current.length === 0 ? (
              <span className="muted small">These songs have no tags yet.</span>
            ) : (
              <>
                <div className="tag-chips">
                  {current.map(({ tag, n }) => (
                    <button key={tag} className={`chip${marked(tag) ? " removing" : ""}`} aria-pressed={marked(tag)} onClick={() => toggleRemove(tag)}>
                      {tag}
                      <span className="chip-count">{n === songs.length ? "all" : `${n} of ${songs.length}`}</span>
                    </button>
                  ))}
                </div>
                <span className="muted small">Tap the tags to take off these songs.</span>
              </>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <button className="primary" disabled={busy || (add.length === 0 && remove.length === 0)} onClick={apply}>
          {busy ? "Saving…" : add.length === 0 && remove.length === 0 ? "Choose tags to add or remove" : `Apply to ${count}`}
        </button>
      </div>
    </div>
  );
}
