import { diffChars, diffWords, diffWordsWithSpace, diffTrimmedLines, diffSentences, type Change } from "diff";
import { lineDiff } from "@/utils/lineChanges";

export const COMPARE_METHODS = ["lines", "trimmedLines", "chars", "words", "wordsWithSpace", "sentences"] as const;
export type CompareMethod = (typeof COMPARE_METHODS)[number];

/** Same six algorithms/options as the characterized legacy viewer. */
export function advancedChanges(oldText: string, newText: string, method: CompareMethod): Change[] {
  switch (method) {
    case "lines": return lineDiff(oldText, newText);
    case "trimmedLines": return diffTrimmedLines(oldText, newText);
    case "chars": return diffChars(oldText, newText);
    case "words": return diffWords(oldText, newText);
    case "wordsWithSpace": return diffWordsWithSpace(oldText, newText);
    case "sentences": return diffSentences(oldText, newText);
  }
}

export type EmphasisRange = [number, number];

/** Map each method's changed units back onto the exact recorded side.
 * Ignored whitespace (words / trimmed lines) stays visible and unmarked.
 */
export function emphasisRanges(oldText: string, newText: string, method: CompareMethod): { old: EmphasisRange[]; new: EmphasisRange[] } {
  const out: { old: EmphasisRange[]; new: EmphasisRange[] } = { old: [], new: [] };
  for (const side of ["old", "new"] as const) {
    const text = side === "old" ? oldText : newText;
    let at = 0;
    for (const part of advancedChanges(oldText, newText, method)) {
      if (side === "old" ? part.added : part.removed) continue;
      const found = text.indexOf(part.value, at);
      // diffWords may normalize unchanged whitespace. Locate non-whitespace
      // tokens individually rather than shifting following changed ranges.
      if (found < 0) {
        for (const token of part.value.matchAll(/\S+/g)) {
          const start = text.indexOf(token[0], at);
          if (start < 0) continue;
          if (side === "old" ? part.removed : part.added) out[side].push([start, start + token[0].length]);
          at = start + token[0].length;
        }
      } else {
        if (side === "old" ? part.removed : part.added) out[side].push([found, found + part.value.length]);
        at = found + part.value.length;
      }
    }
  }
  return out;
}
