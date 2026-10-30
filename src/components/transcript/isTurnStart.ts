import type { ClaudeMessage } from "@/types";
import { classifyMessage, isCodexHeartbeat } from "../MessageViewer/helpers/messageKinds";

export type TurnStartKind = "human" | "automated";

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
