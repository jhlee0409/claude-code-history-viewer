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
  // Lowercasing can expand a code point (İ → i + combining dot). Search in
  // the same folded string, but slice the original UTF-16 coordinates.
  const offsets: [number, number][] = [];
  if (lower.length !== text.length) {
    let start = 0;
    for (const char of text) {
      for (let i = 0; i < char.toLowerCase().length; i++) offsets.push([start, start + char.length]);
      start += char.length;
    }
  }
  const ranges: [number, number][] = [];
  let at = lower.indexOf(query);
  while (at !== -1) {
    const range: [number, number] = offsets.length ? [offsets[at]![0], offsets[at + query.length - 1]![1]] : [at, at + query.length];
    if (!ranges.length || range[0] >= ranges[ranges.length - 1]![1]) ranges.push(range);
    at = lower.indexOf(query, at + query.length);
  }
  return ranges;
}
