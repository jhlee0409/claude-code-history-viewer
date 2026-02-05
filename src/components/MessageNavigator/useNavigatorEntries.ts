import { useMemo } from "react";
import type { ClaudeMessage } from "../../types";
import type { NavigatorEntryData } from "./types";
import { extractClaudeMessageContent, getToolUseBlock } from "../../utils/messageUtils";
import { isEmptyMessage } from "../MessageViewer/helpers/messageHelpers";

/** Types to filter out as noise in the navigator */
const NOISE_TYPES = new Set(["progress", "queue-operation", "file-history-snapshot"]);

/** Strip XML tags from content for clean preview */
function stripXmlTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate text to maxLength, respecting word boundaries when possible */
function truncatePreview(text: string, maxLength = 100): string {
  if (text.length <= maxLength) return text;
  // Use string.slice for Unicode safety (CJK characters)
  const truncated = text.slice(0, maxLength);
  // Try to break at last space
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + "…";
  }
  return truncated + "…";
}

export function useNavigatorEntries(messages: ClaudeMessage[]): NavigatorEntryData[] {
  return useMemo(() => {
    if (!messages || messages.length === 0) return [];

    const entries: NavigatorEntryData[] = [];
    let turnIndex = 0;

    for (const message of messages) {
      // Filter out noise types
      if (NOISE_TYPES.has(message.type)) continue;

      // Filter out empty messages
      if (isEmptyMessage(message)) continue;

      // Extract preview text
      const rawContent = extractClaudeMessageContent(message);
      const toolUse = getToolUseBlock(message);
      let preview = "";
      if (rawContent) {
        preview = truncatePreview(stripXmlTags(rawContent));
      } else if (toolUse) {
        preview = toolUse.name || "Tool Use";
      }

      // Determine role
      const role = (message.type === "user" || message.type === "assistant" || message.type === "system" || message.type === "summary")
        ? message.type
        : "system";

      turnIndex++;

      entries.push({
        uuid: message.uuid,
        role,
        preview: preview || `(${role} message)`,
        timestamp: message.timestamp || "",
        hasToolUse: toolUse !== null,
        turnIndex,
      });
    }

    return entries;
  }, [messages]);
}
