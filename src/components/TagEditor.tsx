import { useMemo, useState } from "react";
import { cleanTags, TAG_LIMITS, type TagSuggestions } from "../../shared/types.ts";

/**
 * A song's tags as chips (tap × to remove), with a box to add more. While the
 * box is selected, team and player names and tags already in use are offered,
 * narrowed by what's typed.
 */
export function TagEditor({
  tags,
  suggestions,
  onChange,
  label = "Tags",
}: {
  tags: string[];
  suggestions: TagSuggestions;
  onChange(tags: string[]): void;
  label?: string;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const full = tags.length >= TAG_LIMITS.maxTags;

  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const add = (t: string) => {
    const next = cleanTags([...tags, ...t.split(",")]);
    if (next.length !== tags.length) onChange(next);
    setText("");
  };

  const offers = useMemo(() => {
    const q = text.trim().toLowerCase();
    const groups: { label: string; items: string[] }[] = [
      { label: "Teams", items: suggestions.teams },
      { label: "Players", items: suggestions.players },
      { label: "Other tags", items: suggestions.used },
    ];
    const seen = new Set(tags.map((t) => t.toLowerCase()));
    return groups
      .map((g) => ({
        label: g.label,
        items: g.items.filter((t) => {
          const k = t.toLowerCase();
          if (seen.has(k) || (q && !k.includes(q))) return false;
          seen.add(k); // a player named like a team shows once
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [suggestions, tags, text]);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="field-label">{label}</span>
      {tags.length > 0 && (
        <div className="tag-chips">
          {tags.map((t) => (
            <span key={t} className="chip on removable">
              {t}
              <button aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-input">
        <input
          value={text}
          disabled={full}
          maxLength={TAG_LIMITS.maxLength}
          placeholder={full ? `Up to ${TAG_LIMITS.maxTags} tags` : "Add a tag: a team, a player…"}
          aria-label="Add a tag"
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text.trim()) add(text);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) add(text);
            }
          }}
        />
        {focused && offers.length > 0 && (
          // Tapping an idea mustn't take focus from the box first, or the list would close.
          <div className="tag-offers" onMouseDown={(e) => e.preventDefault()}>
            {offers.map((g) => (
              <div key={g.label} className="stack" style={{ gap: 4 }}>
                <span className="faint small">{g.label}</span>
                <div className="tag-chips">
                  {g.items.slice(0, 30).map((t) => (
                    <button key={t} className="chip" onClick={() => !has(t) && add(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
