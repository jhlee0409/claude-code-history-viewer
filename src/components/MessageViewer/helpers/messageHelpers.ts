/**
 * Message Helpers
 *
 * General utility functions for message processing.
 */

import type { ClaudeMessage } from "../../../types";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";

/**
 * Check if a message has system command content (XML tags)
 */
export const hasSystemCommandContent = (message: ClaudeMessage): boolean => {
  const content = extractClaudeMessageContent(message);
  if (!content || typeof content !== "string") return false;
  // Check for actual XML tag pairs, not just strings in backticks
  return /<command-name>[\s\S]*?<\/command-name>/.test(content) ||
    /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/.test(content) ||
    /<command-message>[\s\S]*?<\/command-message>/.test(content);
};

/**
 * Check if a message is empty (no meaningful content to display)
 *
 * Messages with command-name tags are NOT empty - they should be rendered
 * as command indicators (e.g., "/clear", "/help").
 *
 * Messages with ONLY local-command-caveat, stdout, stderr, or empty command output
 * ARE considered empty because they have no user-visible content.
 */
export const isEmptyMessage = (message: ClaudeMessage): boolean => {
  // Snapshot blocks have dedicated renderer and no standard "content" payload.
  if (message.type === "file-history-snapshot") {
    return false;
  }

  // Messages with tool use or results should be shown
  if (
    (message.type === "assistant" && message.toolUse) ||
    ((message.type === "user" || message.type === "assistant") &&
      message.toolUseResult)
  ) {
    return false;
  }

  // Progress messages should be shown
  if (message.type === "progress" && (message as ClaudeMessage & { data?: unknown }).data) return false;

  // Check for array content (tool results, etc.)
  if (message.content && Array.isArray(message.content) && message.content.length > 0) {
    return false;
  }

  const content = extractClaudeMessageContent(message);

  // No content at all
  if (!content) return true;

  // Non-string content that exists
  if (typeof content !== "string") return false;

  // Messages with command-name tags should be shown (rendered by CommandRenderer)
  if (/<command-name>[\s\S]*?<\/command-name>/.test(content)) {
    return false;
  }

  // Check for local-command-stdout with non-empty content BEFORE stripping
  // This is user-visible output (e.g., /cost results) unlike system-only tags
  const stdoutMatch = content.match(/<local-command-stdout>\s*([\s\S]*?)\s*<\/local-command-stdout>/);
  if (stdoutMatch && stdoutMatch[1] && stdoutMatch[1].trim().length > 0) {
    return false;
  }

  // Strip system-only tags and check if anything meaningful remains
  const stripped = content
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<[^>]*(?:stdout|output)[^>]*>[\s\S]*?<\/[^>]*>/g, "")
    .replace(/<[^>]*(?:stderr|error)[^>]*>[\s\S]*?<\/[^>]*>/g, "")
    .trim();

  return stripped.length === 0;
};

/**
 * Type-safe parent UUID extraction
 */
export const getParentUuid = (message: ClaudeMessage): string | null | undefined => {
  const msgWithParent = message as ClaudeMessage & {
    parentUuid?: string;
    parent_uuid?: string;
  };
  return msgWithParent.parentUuid || msgWithParent.parent_uuid;
};
