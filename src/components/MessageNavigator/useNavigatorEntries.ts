import { useMemo } from "react";
import type { ClaudeMessage } from "../../types";
import type { NavigatorEntryData } from "./types";
import { getToolUseBlock } from "../../utils/messageUtils";
import { isEmptyMessage } from "../MessageViewer/helpers/messageHelpers";
import { classifyMessage, type MessageKindInfo } from "../MessageViewer/helpers/messageKinds";

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

/** "/name args" for a slash command; the tag-stripped text for command output */
function formatCommand(text: string): string {
  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim();
  if (!name) return stripXmlTags(text);
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

function previewText(info: MessageKindInfo, toolName: string | undefined): string {
  if (info.kind === "agent-update" && info.notification?.summary) {
    return info.notification.summary;
  }
  if (info.text) {
    return info.kind === "command" ? formatCommand(info.text) : stripXmlTags(info.text);
  }
  return toolName ?? "";
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

      const info = classifyMessage(message);
      const toolUse = getToolUseBlock(message);
      // An empty preview is rendered as the kind label by NavigatorEntry.
      const preview = truncatePreview(previewText(info, toolUse?.name || undefined));

      // Determine role
      const role = (message.type === "user" || message.type === "assistant" || message.type === "system" || message.type === "summary")
        ? message.type
        : "system";

      turnIndex++;

      entries.push({
        uuid: message.uuid,
        role,
        kind: info.kind,
        preview,
        status: info.notification?.status,
        timestamp: message.timestamp || "",
        hasToolUse: toolUse !== null,
        turnIndex,
      });
    }

    return entries;
  }, [messages]);
}
