import { diffLines, type Change } from "diff";

/**
 * How an old → new text replacement is counted wherever the app shows its
 * size: the Edit row's "+a −d", the DiffView's lines and counts, and the
 * line view of AdvancedTextDiff read the same diff and the same counts, so
 * they never disagree (renderer audit TC4). A missing newline at the end of
 * one side is not a changed line.
 */
export function lineDiff(oldText: string, newText: string): Change[] {
  return diffLines(oldText, newText, { ignoreNewlineAtEof: true });
}

export interface ChangeCounts {
  added: number;
  removed: number;
  unchanged: number;
}

/**
 * Lines added / removed by a list of old → new replacements (an Edit's own
 * pair, or each of a MultiEdit's edits). The one count the Edit row's
 * "+a −d" and the DiffView below it both show (plan amendment 6).
 */
export function replacementCounts(pairs: ReadonlyArray<readonly [string, string]>): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const [oldText, newText] of pairs) {
    const c = changeCounts(lineDiff(oldText, newText));
    added += c.added;
    removed += c.removed;
  }
  return { added, removed };
}

/** Units (lines, words, characters: whatever the diff split by) per kind of part. */
export function changeCounts(parts: readonly Change[]): ChangeCounts {
  const counts: ChangeCounts = { added: 0, removed: 0, unchanged: 0 };
  for (const part of parts) {
    const units = part.count ?? 0;
    if (part.added) counts.added += units;
    else if (part.removed) counts.removed += units;
    else counts.unchanged += units;
  }
  return counts;
}
