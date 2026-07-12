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

export function applyMessageDisplayFilter(
  messages: ClaudeMessage[],
  messageFilter: MessageFilter,
): ClaudeMessage[] {
  const { roles, contentTypes } = messageFilter;
  const allRoles = roles.user && roles.assistant;
  const allContent = contentTypes.text && contentTypes.thinking && contentTypes.toolCalls && contentTypes.commands;
  const parallelTaskFilteredMessages = filterMessagesByCategory(
    messages,
    "parallel-task",
    contentTypes.parallelTasks,
  );
  if (allRoles && allContent) return parallelTaskFilteredMessages;

  return parallelTaskFilteredMessages.filter((msg) => {
    // Role filter
    if (msg.type === "user") return roles.user;
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
