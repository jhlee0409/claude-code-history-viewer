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
    // Recorded structured-patch coordinates have no safe successor past MAX_SAFE_INTEGER.
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

/** GROUNDED_REAL_DATA_ONLY: Claude records contain oldStart/newStart/oldLines/newLines/lines
 * (153 hunks): cchv-handoff/format-audit/evidence/claude_scan.structural.json:943-967.
 * These are recorded hunk coordinates, unlike Codex change_context anchors. */
export function structuredSections(value: unknown): DiffSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(patch => {
    if (patch === null || typeof patch !== "object" || !Array.isArray(patch.lines) || !patch.lines.every((line: unknown) => typeof line === "string")) return [];
    return [patchSection(patch.lines, typeof patch.oldStart === "number" ? patch.oldStart : 1, typeof patch.newStart === "number" ? patch.newStart : undefined)];
  });
}

export interface PatchFile { path: string; sections: DiffSection[] }

/** GROUNDED_SPEC: Codex anchors are not unified-diff coordinates.
 * https://github.com/openai/codex/blob/788b9d7bf6e37f735647b7f84b556c2a807df4d8/codex-rs/apply-patch/src/parser.rs#L193-L247
 * https://github.com/openai/codex/blob/788b9d7bf6e37f735647b7f84b556c2a807df4d8/codex-rs/apply-patch/src/streaming_parser.rs#L175-L377
 * Mirror producer states/marker trimming; retain original patch bytes at the copy boundary.
 */
export function parseApplyPatch(patch: string): PatchFile[] | null {
  // Rust str::trim uses Unicode White_Space (NEL included, BOM excluded).
  const trimEnd = (text: string) => text.replace(/[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/, "");
  const trim = (text: string) => trimEnd(text).replace(/^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/, "");
  let values = trim(patch).replace(/\r\n/g, "\n").split("\n");
  const boundaries = (lines: string[]) => trim(lines[0] ?? "") === "*** Begin Patch" && trim(lines.slice(-1)[0] ?? "") === "*** End Patch";
  if (!boundaries(values)) {
    if (!["<<EOF", "<<'EOF'", '<<"EOF"'].includes(values[0] ?? "") || !values.slice(-1)[0]?.endsWith("EOF") || values.length < 4) return null;
    values = values.slice(1, -1);
    if (!boundaries(values)) return null;
  }
  const files: PatchFile[] = [];
  let mode: "started" | "add" | "delete" | "update" | "ended" = "started";
  let file: PatchFile | undefined;
  let rows: string[] = [];
  let anchor: string | undefined;
  let hasChunk = false; let moved = false; let eof = false; let environment = false;
  const flush = () => {
    if (file && rows.length) file.sections.push({ ...patchSection(rows, null, null), ...(anchor !== undefined ? { anchor } : {}) });
    rows = []; anchor = undefined;
  };
  const validUpdate = () => mode !== "update" || (hasChunk && rows.length > 0);
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    const trimmed = trim(value);
    // finish() recognizes the last End Patch using trim even in UpdateFile.
    const marker = mode === "update" && index !== values.length - 1 ? trimEnd(value) : trimmed;
    if (mode === "ended") { if (trimmed !== "") return null; continue; }
    if (mode === "started" && marker.startsWith("*** Environment ID:")) {
      if (environment || trim(marker.slice("*** Environment ID:".length)) === "") return null;
      environment = true; continue;
    }
    if (marker === "*** End Patch") {
      if (!validUpdate()) return null;
      flush(); mode = "ended"; continue;
    }
    const header = /^\*\*\* (Add|Delete|Update) File: ([\s\S]+)$/.exec(marker);
    if (header) {
      if (!validUpdate()) return null;
      flush();
      file = { path: header[2]!, sections: [] }; files.push(file);
      mode = header[1] === "Add" ? "add" : header[1] === "Delete" ? "delete" : "update";
      hasChunk = false; moved = false; eof = false; continue;
    }
    if (mode === "add") { if (!value.startsWith("+")) return null; rows.push(value); continue; }
    if (mode !== "update") return null;
    const context = marker === "@@" || marker.startsWith("@@ ");
    if (eof) {
      if (marker === "") continue;
      if (!context) return null;
    }
    if (!hasChunk && !moved && marker.startsWith("*** Move to: ")) { moved = true; continue; }
    if (context) {
      if (hasChunk && rows.length === 0) return null;
      flush(); anchor = marker === "@@" ? undefined : marker.slice(3);
      hasChunk = true; eof = false; continue;
    }
    if (marker === "*** End of File") {
      if (hasChunk && rows.length === 0) return null;
      if (hasChunk) eof = true;
      continue;
    }
    if (value === "" || /^[ +-]/.test(value)) { rows.push(value); hasChunk = true; continue; }
    return null;
  }
  return mode === "ended" ? files : null;
}
