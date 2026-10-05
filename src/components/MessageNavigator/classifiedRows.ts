import type { ClaudeMessage } from "../../types";
import type { NavigatorEntryData } from "./types";
import { getToolUseBlock } from "../../utils/messageUtils";
import { isEmptyMessage } from "../MessageViewer/helpers/messageHelpers";
import {
  classifyMessage,
  isFailedTaskStatus,
  parseTaskNotifications,
  type MessageKindInfo,
} from "../MessageViewer/helpers/messageKinds";

/** Types to filter out as noise in the navigator */
export const NOISE_TYPES = new Set(["progress", "queue-operation", "file-history-snapshot"]);

/** Strip XML tags from content for clean preview */
export function stripXmlTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate text to maxLength, respecting word boundaries when possible */
export function truncatePreview(text: string, maxLength = 100): string {
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
export function formatCommand(text: string): string {
  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim();
  if (!name) return stripXmlTags(text);
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  return args ? `${name} ${args}` : name;
}

export function previewText(info: MessageKindInfo, toolName: string | undefined): string {
  if (info.kind === "agent-update" && info.notification?.summary) {
    return info.notification.summary;
  }
  if (info.text) {
    return info.kind === "command" ? formatCommand(info.text) : stripXmlTags(info.text);
  }
  return toolName ?? "";
}

/** A failed notification anywhere in the block outranks the first one's status. */
export function entryStatus(info: MessageKindInfo): string | undefined {
  if (info.kind !== "agent-update" || !info.text) return undefined;
  const statuses = parseTaskNotifications(info.text).map((notification) => notification.status);
  return statuses.find(isFailedTaskStatus) ?? statuses[0];
}

/** A row surviving the navigator's noise/empty filter, classified once. */
export interface ClassifiedRow {
  message: ClaudeMessage;
  info: MessageKindInfo;
  entry: NavigatorEntryData;
}

/**
 * Filters out noise types and empty messages, classifies each surviving row,
 * and builds its `NavigatorEntryData`, in one pass. `MessageNavigator` feeds
 * one result to both the flat list and the outline's `groupTurns`, so the
 * noise-filter rule cannot drift between the two views.
 */
export function getFilteredClassifiedMessages(messages: ClaudeMessage[]): ClassifiedRow[] {
  if (!messages || messages.length === 0) return [];

  const rows: ClassifiedRow[] = [];
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

    const entry: NavigatorEntryData = {
      uuid: message.uuid,
      role,
      kind: info.kind,
      preview,
      status: entryStatus(info),
      timestamp: message.timestamp || "",
      hasToolUse: toolUse !== null,
      turnIndex,
    };

    rows.push({ message, info, entry });
  }

  return rows;
}
