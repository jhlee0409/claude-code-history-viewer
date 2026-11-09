/**
 * Role / content-type display filter shared by the message list and export.
 *
 * Extracted from the MessageViewer `displayMessages` memo so that export can
 * apply the exact same filtering to a freshly fetched FULL session (the store
 * may only hold a paginated window of it).
 */

import type { ClaudeMessage } from "../../../types";
import type { MessageFilter } from "../../../store/slices/filterSlice";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";
import { filterMessagesByCategory } from "./messageCategories";
import { classifyMessage, isCodexHeartbeat } from "./messageKinds";
import { codexAutomatedTurns } from "../../transcript/codexTurns";
import { turnStartKinds } from "../../transcript/isTurnStart";

/**
 * The prompts the user typed (human turn starts) plus, for each, the last
 * assistant message with text before the next typed prompt. Automated turns
 * (agent updates, heartbeats) do not end a turn, so a reply to one counts as
 * the final reply when nothing else follows it.
 *
 * Computed over the unfiltered list so "final" means final in the
 * conversation, not in whatever the other filters left visible.
 */
function promptAndFinalReplyUuids(
  messages: ClaudeMessage[],
  ctx: { inSubagent: boolean },
): Set<string> {
  const starts = turnStartKinds(messages, ctx);
  const keep = new Set<string>();
  let lastReply: string | null = null;
  for (const msg of messages) {
    if (msg.isSidechain && !ctx.inSubagent) continue;
    if (starts.get(msg.uuid) === "human") {
      if (lastReply) keep.add(lastReply);
      lastReply = null;
      keep.add(msg.uuid);
    } else if (msg.type === "assistant" && extractClaudeMessageContent(msg)?.trim()) {
      lastReply = msg.uuid;
    }
  }
  if (lastReply) keep.add(lastReply);
  return keep;
}

export function applyMessageDisplayFilter(
  messages: ClaudeMessage[],
  messageFilter: MessageFilter,
  ctx: { inSubagent: boolean } = { inSubagent: false },
): ClaudeMessage[] {
  const { roles, contentTypes } = messageFilter;
  const allRoles = roles.user && roles.assistant;
  const allContent = contentTypes.text && contentTypes.thinking && contentTypes.toolCalls && contentTypes.commands;
  const parallelTaskFilteredMessages = filterMessagesByCategory(
    messages,
    "parallel-task",
    contentTypes.parallelTasks,
  );
  const promptsAndReplies = messageFilter.promptsAndFinalReplies ? promptAndFinalReplyUuids(messages, ctx) : null;
  const candidates = promptsAndReplies
    ? parallelTaskFilteredMessages.filter((msg) => promptsAndReplies.has(msg.uuid))
    : parallelTaskFilteredMessages;
  if (allRoles && allContent) return candidates;

  const automated = !roles.assistant ? codexAutomatedTurns(messages).uuids : new Set<string>();
  return candidates.filter((msg) => {
    // Role filter
    if (msg.type === "user") {
      // Owner decision: user-only means human input, not automatic producer
      // cycles. Keep automation in all-messages; the model owns its own turns.
      if (!roles.assistant && (automated.has(msg.uuid) || classifyMessage(msg).kind === "agent-update" || isCodexHeartbeat(msg))) return false;
      return roles.user;
    }
    if (msg.type === "assistant") {
      if (!roles.assistant) return false;
      // Content type filter — check if assistant message has any visible content left
      if (!allContent) {
        const hasText = contentTypes.text && !!extractClaudeMessageContent(msg);
        const hasContentArray = Array.isArray(msg.content) && msg.content.some((item: unknown) => {
          if (!item || typeof item !== "object") return false;
          const typed = item as Record<string, unknown>;
          const t = typed.type as string;
          if (t === "text") return contentTypes.text;
          if (t === "thinking" || t === "redacted_thinking") return contentTypes.thinking;
          if (t === "tool_use" || t === "tool_result" || t === "server_tool_use"
            || t === "web_search_tool_result" || t === "mcp_tool_use" || t === "mcp_tool_result"
            || t === "web_fetch_tool_result" || t === "code_execution_tool_result"
            || t === "bash_code_execution_tool_result" || t === "text_editor_code_execution_tool_result"
            || t === "tool_search_tool_result") return contentTypes.toolCalls;
          if (t === "command") return contentTypes.commands;
          return true; // image, document, search_result — always show
        });
        const hasLegacyTool = contentTypes.toolCalls && !!(msg.toolUse || msg.toolUseResult);
        if (!hasText && !hasContentArray && !hasLegacyTool) return false;
      }
      return true;
    }
    return true; // system/summary/other
  });
}
