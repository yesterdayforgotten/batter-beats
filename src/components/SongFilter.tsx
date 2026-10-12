import { useMemo, useState } from "react";
import { hasTags, songMatches, type Song } from "../../shared/types.ts";

/** Search words and chosen tags, and the songs that match both. */
export function useSongFilter<S extends Song>(songs: S[] | null) {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const shown = useMemo(
    () => (songs ?? []).filter((s) => songMatches(s, query) && hasTags(s, tags)),
    [songs, query, tags],
  );
  /** Every tag in the library, most used first. */
  const allTags = useMemo(() => {
    const counts = new Map<string, { tag: string; n: number }>();
    for (const s of songs ?? []) {
      for (const t of s.tags) {
        const k = t.toLowerCase();
        counts.set(k, { tag: counts.get(k)?.tag ?? t, n: (counts.get(k)?.n ?? 0) + 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((c) => c.tag);
  }, [songs]);
  const filtering = query.trim() !== "" || tags.length > 0;
  return { query, setQuery, tags, setTags, shown, allTags, filtering };
}

/** Search box plus a row of tag chips; tapping chips narrows the list to songs with all of them. */
export function SongFilterBar({
  filter,
  placeholder = "Search title, artist or tag",
}: {
  filter: ReturnType<typeof useSongFilter>;
  placeholder?: string;
}) {
  const { query, setQuery, tags, setTags, allTags } = filter;
  // Tags being filtered by stay as chips even if no song has them any more (say, just
  // removed from every song), so they can still be tapped off.
  const chips = [...allTags, ...tags.filter((t) => !allTags.some((a) => a.toLowerCase() === t.toLowerCase()))];
  const toggle = (t: string) =>
    setTags(tags.some((x) => x.toLowerCase() === t.toLowerCase()) ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input value={query} enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label="Search songs" />
      {chips.length > 0 && (
        <div className="tag-chips" role="group" aria-label="Filter by tag">
          {chips.map((t) => {
            const on = tags.some((x) => x.toLowerCase() === t.toLowerCase());
            return (
              <button key={t} className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(t)}>
                {t}
              </button>
            );
          })}
          {filter.filtering && (
            <button
              className="link-button clear-filters"
              onClick={() => {
                setQuery("");
                setTags([]);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
