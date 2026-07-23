/**
 * RecentEditsViewer Diff Utilities
 *
 * Pure helpers to extract only-added / only-removed line groups from an edit,
 * used by the +N / -N filtered views in FileEditItem.
 */

import { diffLines } from "diff";

/**
 * A contiguous group of added or removed lines.
 * `startLine` is 1-based: for added groups it refers to the new file,
 * for removed groups it refers to the original file.
 */
export interface DiffLineGroup {
  startLine: number;
  lines: string[];
}

const splitPartLines = (value: string): string[] => {
  const lines = value.split("\n");
  // diffLines() parts keep their trailing newline, producing one empty tail entry
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

const extractLineGroups = (
  oldText: string,
  newText: string,
  kind: "added" | "removed"
): DiffLineGroup[] => {
  const groups: DiffLineGroup[] = [];
  let oldLine = 1;
  let newLine = 1;

  // ignoreNewlineAtEof: a missing trailing newline should not flag the last
  // line as changed (git renders this as "\ No newline at end of file")
  for (const part of diffLines(oldText, newText, { ignoreNewlineAtEof: true })) {
    const lines = splitPartLines(part.value);
    if (part.added) {
      if (kind === "added" && lines.length > 0) {
        groups.push({ startLine: newLine, lines });
      }
      newLine += lines.length;
    } else if (part.removed) {
      if (kind === "removed" && lines.length > 0) {
        groups.push({ startLine: oldLine, lines });
      }
      oldLine += lines.length;
    } else {
      oldLine += lines.length;
      newLine += lines.length;
    }
  }

  return groups;
};

/**
 * Extract the lines added by an edit, grouped by contiguous hunks.
 * `oldText` is undefined for newly created files (write operations),
 * in which case every line counts as added.
 */
export const extractAddedLines = (
  oldText: string | undefined,
  newText: string
): DiffLineGroup[] => extractLineGroups(oldText ?? "", newText, "added");

/**
 * Extract the lines removed by an edit, grouped by contiguous hunks.
 * Returns an empty array for newly created files.
 */
export const extractRemovedLines = (
  oldText: string | undefined,
  newText: string
): DiffLineGroup[] => extractLineGroups(oldText ?? "", newText, "removed");
