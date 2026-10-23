import { diffLines, type Change } from "diff";

/**
 * How an old → new text replacement is counted wherever the app shows its
 * size: the Edit row's "+a −d" and the line view of the diff box below it
 * (AdvancedTextDiff) read the same diff and the same counts, so the two
 * never disagree (renderer audit TC4). A missing newline at the end of one
 * side is not a changed line.
 */
export function lineDiff(oldText: string, newText: string): Change[] {
  return diffLines(oldText, newText, { ignoreNewlineAtEof: true });
}

export interface ChangeCounts {
  added: number;
  removed: number;
  unchanged: number;
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
