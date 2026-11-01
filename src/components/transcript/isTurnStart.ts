import type { ClaudeMessage } from "@/types";
import { classifyMessage, isCodexHeartbeat } from "../MessageViewer/helpers/messageKinds";

export type TurnStartKind = "human" | "automated";

import { codexAutomatedTurns } from "./codexTurns";

/** Loaded-window projection shared by model and outline; no ordinal is synthesized. */
export function turnStartKinds(messages: readonly ClaudeMessage[], ctx: { inSubagent: boolean }): ReadonlyMap<string, TurnStartKind> {
  const automated = codexAutomatedTurns(messages).starts;
  const kinds = new Map<string, TurnStartKind>();
  for (const message of messages) {
    if (message.isSidechain && !ctx.inSubagent) continue;
    const kind = automated.has(message.uuid) ? "automated" : turnStartKind(message, ctx);
    if (kind) kinds.set(message.uuid, kind);
  }
  return kinds;
}

/** Transcript/index boundary and provenance, separate from legacy UI row kinds. */
export function turnStartKind(message: ClaudeMessage, ctx: { inSubagent: boolean }): TurnStartKind | null {
  if (message.type !== "user" || (message.isSidechain && !ctx.inSubagent)) return null;
  if ((message as ClaudeMessage & { isMeta?: boolean }).isMeta) return null;
  const { kind, text } = classifyMessage(message);
  // Owner decision grounded in Claude 2.1.x promptId/origin cycles (110
  // notifications, 76 with tools) and Codex heartbeat UserMessage events (34).
  // See docs/contracts/transcript-items.md; neither is a human typed prompt.
  if (kind === "agent-update" || (kind === "context" && isCodexHeartbeat(message))) return "automated";
  if (kind === "prompt" || (kind === "command" && text?.includes("<command-name>"))) return "human";
  // UNGROUNDED attachment-beside-result fallback; preserve, do not certify forks.
  return kind === "tool" && Array.isArray(message.content) && message.content.some(block => block.type === "image" || block.type === "document") ? "human" : null;
}

export function isTurnStart(message: ClaudeMessage, ctx: { inSubagent: boolean }): boolean {
  return turnStartKind(message, ctx) !== null;
}
