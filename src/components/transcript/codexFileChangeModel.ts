import type { ClaudeMessage } from "@/types";
import type { DiffSection } from "./DiffView";
import { recordedFileChangeContent } from "./toolOutcome";
import { patchSection } from "./patchDiff";

export interface CodexChange { path: string; operation: "update" | "add" | "delete"; movePath?: string; source: string; sections: DiffSection[] | null }
export interface CodexChangeEvent { id: string; turnId?: string; carrier: string; changes: CodexChange[]; record: unknown }
const obj = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

/** Recorded unified coordinates ONLY. Reject malformed/count-mismatched hunks
 * rather than letting patchSection's defaults invent a starting line. */
export function unifiedSections(source: string): DiffSection[] | null {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const sections: DiffSection[] = [];
  let index = 0;
  while (index < lines.length && /^(--- |\+\+\+ |diff |index )/.test(lines[index]!)) index++;
  while (index < lines.length) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[index++]!);
    if (!match) return null;
    const [oldStart, oldCount, newStart, newCount] = [Number(match[1]), Number(match[2] ?? 1), Number(match[3]), Number(match[4] ?? 1)];
    if (![oldStart, oldCount, newStart, newCount, oldStart! + oldCount!, newStart! + newCount!].every(Number.isSafeInteger)) return null;
    const rows: string[] = [];
    let old = 0; let next = 0;
    while (index < lines.length && !lines[index]!.startsWith("@@ ")) {
      const line = lines[index++]!;
      if (line === "\\ No newline at end of file") { rows.push(line); continue; }
      if (!/^[ +-]/.test(line)) return null;
      if (!line.startsWith("+")) old++;
      if (!line.startsWith("-")) next++;
      rows.push(line);
    }
    if (old !== oldCount || next !== newCount) return null;
    sections.push(patchSection(rows, oldStart!, newStart!));
  }
  return sections.length ? sections : null;
}

/** FileChangeItem.id is ctx.call_id, not its transport carrier's call.
 * tools/events.rs@6aaac694:601–620; protocol.rs:3838–3878,4342–4355.
 * Code-mode inner calls often have no corresponding normalized tool call;
 * retain those as separate producer events, never guess from proximity/text. */
export function codexChangeEvents(messages: readonly ClaudeMessage[]): CodexChangeEvent[] {
  const events: CodexChangeEvent[] = [];
  for (const message of messages) {
    if (message.provider !== "codex") continue;
    for (const entry of message.codexEvidence?.fileChanges ?? []) {
      const record = obj(entry.record); const payload = obj(record?.payload);
      const item = payload?.type === "item_completed" ? obj(payload.item) : payload;
      if (!item || (payload?.type === "item_completed" ? item.type !== "FileChange" : !["patch_apply_begin", "patch_apply_updated", "patch_apply_end"].includes(String(item.type)))) continue;
      const id = payload?.type === "item_completed" ? item.id : item.call_id;
      const changes = obj(item.changes);
      if (typeof id !== "string" || !changes) continue;
      const files: CodexChange[] = [];
      for (const [path, value] of Object.entries(changes)) {
        const change = obj(value);
        const contents = recordedFileChangeContent(value);
        if (change?.type === "update" && typeof change.unified_diff === "string") {
          files.push({ path, operation: "update", movePath: typeof change.move_path === "string" ? change.move_path : undefined, source: change.unified_diff, sections: unifiedSections(change.unified_diff) });
        } else if ((change?.type === "add" || change?.type === "delete") && contents !== undefined) {
          const rows = contents.split("\n");
          if (rows.at(-1) === "") rows.pop();
          files.push({ path, operation: change.type, source: contents, sections: [patchSection(rows.map(line => `${change.type === "add" ? "+" : "-"}${line}`), null, null)] });
        }
      }
      if (files.length) events.push({ id, turnId: typeof payload?.turn_id === "string" ? payload.turn_id : undefined, carrier: message.uuid, changes: files, record: entry.record });
    }
  }
  return events;
}
