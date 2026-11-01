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

const isLoadedStart = (message: ClaudeMessage): boolean => {
  if (message.type !== "progress") return false;
  const data = record(message.data);
  return record(message.codexEvidence?.turn?.started)?.type === "task_started"
    && data?.type === "waiting_for_task" && data.status === "started"
    && typeof data.taskId === "string" && data.taskId !== "" && data.taskId === codexTurnId(message);
};

/** Preserve the actual loaded marker across the store's presentation-only
 * system filter. Carry it only on the first retained row: cropping past that
 * row must remove the marker too. Never mutate raw/backend messages. */
export function retainLoadedCodexStarts(loaded: readonly ClaudeMessage[], visible: ClaudeMessage[]): ClaudeMessage[] {
  const starts = new Map<string, ClaudeMessage>();
  const keyOf = (message: ClaudeMessage) => {
    const id = codexTurnId(message);
    return id ? JSON.stringify([message.sessionId, id]) : undefined;
  };
  for (const message of loaded) {
    const key = keyOf(message);
    if (key && isLoadedStart(message)) starts.set(key, message);
  }
  return visible.map(message => {
    const key = keyOf(message);
    const start = key && starts.get(key);
    if (!key || !start) return message;
    starts.delete(key);
    return { ...message, codexLoadedStart: start };
  });
}

/** Owner policy: no-input goal cycles own their work, not the preceding prompt.
 * ext/goal/src/runtime.rs@6aaac694:480–502 starts ResponseItem steering with
 * turn_trigger="goal"; protocol/src/turn_input.rs:79–96 persists attribution.
 * Older records lack attribution: a loaded, identity-matched context-led cycle
 * with its task_started progress loaded and no human input is a structural
 * no-input-context fallback, not proof of a goal trigger.
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
    // codex.rs converts task_started to progress with turn.started attached.
    // A copied turn.started on later rows is NOT evidence that the start is loaded.
    const loadedStart = group.some(m => isLoadedStart(m) || (m.codexLoadedStart !== undefined
      && isLoadedStart(m.codexLoadedStart) && m.codexLoadedStart.sessionId === m.sessionId
      && codexTurnId(m.codexLoadedStart) === codexTurnId(m)));
    if (hasHuman || (!explicitGoal && (!loadedStart || !contextLed || attribution?.turn_trigger != null))) continue;
    starts.add(first.uuid);
    for (const message of group) uuids.add(message.uuid);
  }
  return { starts, uuids };
}
