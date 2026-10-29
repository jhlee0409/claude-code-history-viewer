import type { ClaudeMessage } from "@/types";
import { classifyMessage } from "../MessageViewer/helpers/messageKinds";

/** Transcript/index predicate, deliberately separate from legacy row-header heuristics. */
export function isTurnStart(message: ClaudeMessage, ctx: { inSubagent: boolean }): boolean {
  if (message.type !== "user" || (message.isSidechain && !ctx.inSubagent)) return false;
  if ((message as ClaudeMessage & { isMeta?: boolean }).isMeta) return false;
  const { kind, text } = classifyMessage(message);
  if (kind === "prompt" || (kind === "command" && text?.includes("<command-name>"))) return true;
  // An attachment beside a result is not a result-only record (subagent forks).
  return kind === "tool" && Array.isArray(message.content) && message.content.some(block => block.type === "image" || block.type === "document");
}
