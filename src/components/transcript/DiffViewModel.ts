/**
 * DiffView's line model (plan §4.3 DiffView row, TR2a), pure.
 *
 * A section is one old → new replacement. Its lines come from `lineDiff`,
 * the same diff `replacementCounts` counts for the Edit row's "+a −d", so the
 * lines drawn and the numbers stated can never disagree (amendment 6).
 */
import { lineDiff } from "@/utils/lineChanges";
import { emphasisRanges, type CompareMethod, type EmphasisRange } from "./advancedCompare";

export interface DiffPair { left?: DiffLine; right?: DiffLine }

/** Pair only within one contiguous replacement run; context is a hard boundary. */
export function pairLines(lines: readonly DiffLine[]): DiffPair[] {
  const result: DiffPair[] = [];
  let left: DiffLine[] = [];
  let right: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(left.length, right.length); i++) result.push({ left: left[i], right: right[i] });
    left = []; right = [];
  };
  for (const line of lines) {
    if (line.kind === "context") { flush(); result.push({ left: line, right: line }); }
    else (line.kind === "del" ? left : right).push(line);
  }
  flush();
  return result;
}

/** Decorate the shared line model without changing source content or counts. */
export function comparedLines(oldText: string, newText: string, oldStart = 1, newStart = oldStart, method?: CompareMethod): DiffLine[] {
  const lines = sectionLines(oldText, newText, oldStart, newStart);
  if (!method || method === "lines") return lines;
  const ranges = emphasisRanges(oldText, newText, method);
  let oldAt = 0; let newAt = 0;
  for (const line of lines) {
    const at = line.kind === "add" ? newAt : oldAt;
    const side = line.kind === "add" ? ranges.new : ranges.old;
    line.emphasis = side.flatMap(([start, end]) => end > at && start < at + line.text.length ? [[Math.max(0, start - at), Math.min(line.text.length, end - at)] as EmphasisRange] : []);
    if (line.kind !== "add") oldAt += line.text.length + 1;
    if (line.kind !== "del") newAt += line.text.length + 1;
  }
  return lines;
}

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number on the old side (`null` on an added line). */
  oldNo: number | null;
  /** Line number on the new side (`null` on a removed line). */
  newNo: number | null;
  text: string;
  emphasis?: EmphasisRange[];
}

/** A diff part's lines: its value without the final newline, split on "\n" (as many as `count`). */
const partLines = (value: string): string[] => (value === "" ? [] : value.replace(/\n$/, "").split("\n"));

/** Every line of `oldText` → `newText`, numbered from `oldStart` / `newStart`. */
export function sectionLines(oldText: string, newText: string, oldStart = 1, newStart = oldStart): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  for (const part of lineDiff(oldText, newText)) {
    for (const text of partLines(part.value)) {
      if (part.added) lines.push({ kind: "add", oldNo: null, newNo: newNo++, text });
      else if (part.removed) lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
      else lines.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  return lines;
}

/** A drawn row: one line, or unchanged lines folded away (a gap the user can open). */
export type DiffRow = { type: "line"; line: DiffLine } | { type: "gap"; lines: DiffLine[] };

/**
 * Keep `context` unchanged lines around each change; fold longer unchanged
 * runs into one gap row. A gap of a single line is drawn as the line (a row
 * saying "1 unchanged line" saves nothing).
 */
export function foldContext(lines: readonly DiffLine[], context: number): DiffRow[] {
  const near = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    for (let i = Math.max(0, index - context); i <= Math.min(lines.length - 1, index + context); i += 1) near[i] = true;
  });
  const rows: DiffRow[] = [];
  let folded: DiffLine[] = [];
  const flush = () => {
    if (folded.length === 1) rows.push({ type: "line", line: folded[0] as DiffLine });
    else if (folded.length > 1) rows.push({ type: "gap", lines: folded });
    folded = [];
  };
  lines.forEach((line, index) => {
    if (line.kind === "context" && !near[index]) {
      folded.push(line);
      return;
    }
    flush();
    rows.push({ type: "line", line });
  });
  flush();
  return rows;
}

/** One recorded replacement of an Edit / MultiEdit. */
export interface EditReplacement {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * Where each replacement starts in the file, from the recorded original:
 * edits apply in order, each to the text the previous one left. `undefined`
 * when it cannot be told for certain — no original, an empty or missing old
 * string, or a replace-all (it may touch many places).
 */
export function editStartLines(originalFile: string, edits: readonly EditReplacement[]): Array<number | undefined> {
  let text = originalFile;
  return edits.map(({ oldString, newString, replaceAll }) => {
    if (text === "" || oldString === "") return undefined;
    const index = text.indexOf(oldString);
    if (index < 0) return undefined;
    const start = replaceAll ? undefined : lineOf(text, index);
    text = replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
    return start;
  });
}

/**
 * The file after the edits, from the recorded original (the old renderer's
 * "file after change"), or "" when it cannot be told: no original, or an
 * edit with no old string (as the old renderer did). A missing old string
 * leaves the text as it is, as the old renderer's `replace` did.
 */
export function fileAfterEdits(originalFile: string, edits: readonly EditReplacement[]): string {
  if (originalFile === "" || edits.length === 0 || edits.some((edit) => edit.oldString === "")) return "";
  let text = originalFile;
  for (const { oldString, newString, replaceAll } of edits) {
    text = replaceAll ? text.split(oldString).join(newString) : text.replace(oldString, () => newString);
  }
  return text;
}
