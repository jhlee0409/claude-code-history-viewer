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
    lines.push({ kind, text, oldNo: kind === "add" || oldNo === null ? null : oldNo++, newNo: kind === "del" || newNo === null ? null : newNo++ });
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
/** Codex apply_patch grammar. Unknown/malformed records fall back to raw JSON. */
export function parseApplyPatch(patch: string): PatchFile[] | null {
  const values = patch.replace(/\r\n/g, "\n").split("\n");
  if (values.shift() !== "*** Begin Patch") return null;
  const files: PatchFile[] = [];
  let file: PatchFile | undefined;
  let rows: string[] = [];
  let ended = false;
  let oldStart: number | null = null; let newStart: number | null = null;
  const flush = () => {
    if (file && rows.length) file.sections.push(patchSection(rows, oldStart, newStart));
    rows = []; oldStart = null; newStart = null;
  };
  for (const value of values) {
    if (ended) { if (value !== "") return null; continue; }
    const match = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(value);
    if (match) { flush(); file = { path: match[1]!, sections: [] }; files.push(file); }
    else if (value === "*** End Patch") { flush(); ended = true; }
    else if (!file) return null;
    else if (value.startsWith("@@")) {
      flush();
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(value);
      if (header) {
        if (!header.slice(1).filter(v => v !== undefined).every(v => Number.isSafeInteger(Number(v)))) return null;
        oldStart = Number(header[1]); newStart = Number(header[3]);
      } else if (/^@@ [+-]\d/.test(value)) return null;
      // Bare @@ / code-context headers record no source coordinates.
    }
    else if (value.startsWith("*** Move to: ") || value === "*** End of File") flush();
    else if (/^[ +-]/.test(value) || value.startsWith("\\ No newline")) rows.push(value);
    else return null;
  }
  return ended && files.length ? files : null;
}
