import type { ClaudeMessage } from "@/types";
import { isToolResultContent, isToolUseContent } from "@/utils/typeGuards";

/** Raw envelope forwarding only; outcome interpretation stays in toolOutcome. */
export function legacyOwnership(message: ClaudeMessage) {
  const content = Array.isArray(message.content) ? message.content : [];
  return {
    value: (message.type === "user" || message.type === "assistant") ? message.toolUseResult : undefined,
    call: message.type === "assistant" && !!message.toolUse && !content.some(isToolUseContent),
    result: (message.type === "user" || message.type === "assistant") && message.toolUseResult != null && !content.some(isToolResultContent),
  };
}
