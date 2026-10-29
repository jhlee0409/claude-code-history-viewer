import { searchRanges } from './searchMarks';

type Range = [number, number];

/** Decoded JSON value hits as original serialized UTF-16 spans (not byte offsets).
 * JSON.parse validates the whole document first. The iterative token walk only
 * maps its lexical spans; it never guesses invalid syntax or rewrites the display.
 * A valid string followed by ':' is a key, never a searchable value. Punctuation
 * and joins between tokens cannot manufacture a hit. Blank/malformed input has none.
 */
export function jsonSearchRanges(text: string, query: string): Range[] {
  if (!query.trim()) return [];
  try { JSON.parse(text); } catch { return []; }
  const ranges: Range[] = [];
  let at = 0;
  while (at < text.length) {
    if ('{}[],: \t\r\n'.includes(text.charAt(at))) { at++; continue; }
    if (text[at] === '"') {
      at++;
      let decoded = '';
      const offsets: Range[] = [];
      while (text[at] !== '"') {
        const start = at;
        // Each JSON escape decodes to one UTF-16 unit. A surrogate pair has
        // two entries, exactly like JS slicing/search, even with \u escapes.
        if (text[at] === '\\') {
          at += text[at + 1] === 'u' ? 6 : 2;
          decoded += JSON.parse('"' + text.slice(start, at) + '"') as string;
        } else {
          decoded += text[at++];
        }
        offsets.push([start, at]);
      }
      at++;
      let next = at;
      while (next < text.length && ' \t\r\n'.includes(text.charAt(next))) next++;
      if (text[next] !== ':') for (const [start, end] of searchRanges(decoded, query)) {
        // Validation plus decoded-unit mapping guarantee both endpoints exist.
        ranges.push([offsets[start]![0], offsets[end - 1]![1]]);
      }
    } else {
      const start = at;
      while (at < text.length && !',]} \t\r\n'.includes(text.charAt(at))) at++;
      // Preserve ordinary numeric/boolean/null substring marking.
      for (const [s, e] of searchRanges(text.slice(start, at), query)) ranges.push([start + s, start + e]);
    }
  }
  return ranges;
}
