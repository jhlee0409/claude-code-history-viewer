import type { ClaudeMessage } from "@/types";
import { classifyMessage } from "../MessageViewer/helpers/messageKinds";

const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Producer identity only; root_turn_id is lineage, NOT a new-turn key.
 * protocol.rs@6aaac694:2303–2323,3428–3433. Null/mismatched evidence stays unknown. */
export function codexTurnId(message: ClaudeMessage): string | undefined {
  if (message.provider !== "codex") return undefined;
  const turn = message.codexEvidence?.turn;
  const started = record(turn?.started);
  const context = record(turn?.context);
  const id = started?.turn_id;
  return typeof id === "string" && id !== "" && (turn?.context === undefined || context?.turn_id === id) ? id : undefined;
}

/** Owner policy: no-input goal cycles own their work, not the preceding prompt.
 * ext/goal/src/runtime.rs@6aaac694:480–502 starts ResponseItem steering with
 * turn_trigger="goal"; protocol/src/turn_input.rs:79–96 persists attribution.
 * Older records lack attribution: a loaded, identity-matched context-led cycle
 * with no human input is a structural fallback, not proof of a goal trigger.
 * Never infer a boundary from wrapper text alone or an assistant-only window.
 */
export function codexAutomatedTurns(messages: readonly ClaudeMessage[]): { starts: ReadonlySet<string>; uuids: ReadonlySet<string> } {
  const groups = new Map<string, ClaudeMessage[]>();
  for (const message of messages) {
    const id = codexTurnId(message);
    if (!id) continue;
    const key = JSON.stringify([message.sessionId, id]);
    const group = groups.get(key) ?? [];
    group.push(message);
    groups.set(key, group);
  }
  const starts = new Set<string>();
  const uuids = new Set<string>();
  for (const group of groups.values()) {
    const visible = group.filter(m => !["progress", "queue-operation", "file-history-snapshot"].includes(m.type));
    const first = visible[0];
    if (!first) continue;
    const attribution = record(record(first.codexEvidence?.turn?.started)?.turn_attribution);
    const explicitGoal = attribution?.turn_trigger === "goal";
    const hasHuman = visible.some(m => m.type === "user" && ["prompt", "command", "agent-update"].includes(classifyMessage(m).kind));
    const contextLed = visible.some(message => message.type === "user" && classifyMessage(message).kind === "context");
    // An explicit non-goal trigger is not the legacy no-attribution fallback.
    if (hasHuman || (!explicitGoal && (!contextLed || attribution?.turn_trigger != null))) continue;
    starts.add(first.uuid);
    for (const message of group) uuids.add(message.uuid);
  }
  return { starts, uuids };
}
