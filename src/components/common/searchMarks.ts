/**
 * The one search-hit rule every in-session search mark follows
 * (`HighlightedText`, `PathText`) and the routed tool bodies count with:
 * trimmed, case-insensitive, non-overlapping, left to right; a blank query has none.
 * Kept apart from the components (react-refresh: a `.tsx` exports only
 * components and constants); a mark's look is `HighlightedText`'s
 * `searchMark*Class`.
 */

/** The `[start, end)` ranges of `searchQuery`'s hits in `text`. */
export function searchRanges(text: string, searchQuery: string): [number, number][] {
  // Trimmed like the hit count (`searchHits`, the session search index), so every counted hit is marked.
  const query = searchQuery.trim().toLowerCase();
  if (!query) return [];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  let at = lower.indexOf(query);
  while (at !== -1) {
    ranges.push([at, at + query.length]);
    at = lower.indexOf(query, at + query.length);
  }
  return ranges;
}
