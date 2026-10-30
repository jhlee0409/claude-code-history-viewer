import type { DiffSection } from "./DiffView";
import type { DiffLine } from "./DiffViewModel";

/** Recorded patch rows, not a re-diff: keep hunk order, numbering and +/- exactly. */
export function patchSection(values: readonly string[], oldStart: number | null = 1, newStart: number | null = oldStart): DiffSection {
  let oldNo = oldStart; let newNo = newStart;
  const lines: DiffLine[] = [];
  const old: string[] = []; const next: string[] = [];
  for (const value of values) {
    if (value.startsWith("\\ No newline")) continue;
    const kind = value.startsWith("+") ? "add" : value.startsWith("-") ? "del" : "context";
    const text = /^[ +-]/.test(value) ? value.slice(1) : value;
    if (kind !== "add") old.push(text);
    if (kind !== "del") next.push(text);
    lines.push({ kind, text, oldNo: kind === "add" ? null : oldNo, newNo: kind === "del" ? null : newNo });
    // There is no safe successor to MAX_SAFE_INTEGER. apply_patch validates
    // the entire range before constructing rows, so this is its final value.
    if (kind !== "add" && oldNo !== null) oldNo = oldNo === Number.MAX_SAFE_INTEGER ? null : oldNo + 1;
    if (kind !== "del" && newNo !== null) newNo = newNo === Number.MAX_SAFE_INTEGER ? null : newNo + 1;
  }
  const copyLines = values.filter(value => !value.startsWith("-")).map(value => /^[ +]/.test(value) ? value.slice(1) : value);
  return { oldText: old.join("\n"), newText: next.join("\n"), oldStart: oldStart ?? undefined, newStart: newStart ?? undefined, lines, copyLines };
}

/** Concatenate recorded after rows, not section strings: empty hunks add no separator.
 * Keep patch metadata verbatim, matching the existing structured-patch copy contract. */
export function patchAfterText(sections: readonly DiffSection[]): string {
  return sections.flatMap(section => section.copyLines ?? (section.newText === "" ? [] : section.newText.split("\n"))).join("\n");
}

export function structuredSections(value: unknown): DiffSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(patch => {
    if (patch === null || typeof patch !== "object" || !Array.isArray(patch.lines) || !patch.lines.every((line: unknown) => typeof line === "string")) return [];
    return [patchSection(patch.lines, typeof patch.oldStart === "number" ? patch.oldStart : 1, typeof patch.newStart === "number" ? patch.newStart : undefined)];
  });
}

export interface PatchFile { path: string; sections: DiffSection[] }

/** Check the last coordinate without first performing an unsafe addition. */
function safeRange(start: number, count: number): boolean {
  return Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(count) && count >= 0
    && (count === 0 || start <= Number.MAX_SAFE_INTEGER - (count - 1));
}

/** Codex apply_patch grammar. Unknown/malformed records fall back to raw JSON. */
export function parseApplyPatch(patch: string): PatchFile[] | null {
  const values = patch.replace(/\r\n/g, "\n").split("\n");
  if (values.shift() !== "*** Begin Patch") return null;
  const files: PatchFile[] = [];
  let file: PatchFile | undefined;
  let rows: string[] = [];
  let ended = false;
  let oldStart: number | null = null; let newStart: number | null = null;
  const flush = (): boolean => {
    const sourceRows = rows.filter(row => !row.startsWith("\\ No newline"));
    if (oldStart !== null && !safeRange(oldStart, sourceRows.filter(row => !row.startsWith("+")).length)) return false;
    if (newStart !== null && !safeRange(newStart, sourceRows.filter(row => !row.startsWith("-")).length)) return false;
    if (file && rows.length) file.sections.push(patchSection(rows, oldStart, newStart));
    rows = []; oldStart = null; newStart = null;
    return true;
  };
  for (const value of values) {
    if (ended) { if (value !== "") return null; continue; }
    const match = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(value);
    if (match) { if (!flush()) return null; file = { path: match[1]!, sections: [] }; files.push(file); }
    else if (value === "*** End Patch") { if (!flush()) return null; ended = true; }
    else if (!file) return null;
    else if (value.startsWith("@@")) {
      if (!flush()) return null;
      // Accepted set: bare @@, canonical numbered ranges (optional counts and
      // trailing code context), or @@ followed by a non-numeric code label.
      // Do not reinterpret malformed numeric/combined syntax as a code label.
      const header = /^@@ -(0|[1-9]\d*)(?:,(0|[1-9]\d*))? \+(0|[1-9]\d*)(?:,(0|[1-9]\d*))? @@(?: .*)?$/.exec(value);
      if (header) {
        if (!header.slice(1).filter(v => v !== undefined).every(v => Number.isSafeInteger(Number(v)))) return null;
        oldStart = Number(header[1]); newStart = Number(header[3]);
        if (!safeRange(oldStart, Number(header[2] ?? 1)) || !safeRange(newStart, Number(header[4] ?? 1))) return null;
      } else if (value !== "@@" && !/^@@ [^\s@+\-\d].*$/.test(value)) return null;
    }
    else if (value.startsWith("*** Move to: ") || value === "*** End of File") { if (!flush()) return null; }
    else if (/^[ +-]/.test(value) || value.startsWith("\\ No newline")) rows.push(value);
    else return null;
  }
  return ended && files.length ? files : null;
}
