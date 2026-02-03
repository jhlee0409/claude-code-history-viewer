/**
 * Type Guards Utility
 *
 * Runtime type checking functions for type-safe narrowing.
 * Extracted from type definition files for better separation of concerns.
 */

import type {
  ClaudeMessage,
  ClaudeUserMessage,
  ClaudeAssistantMessage,
  ClaudeSystemMessage,
  ClaudeSummaryMessage,
  ClaudeFileHistoryMessage,
  ClaudeProgressMessage,
  ClaudeQueueMessage,
  ContentItem,
  ToolUseContent,
  ToolResultContent,
  TextContent,
  ThinkingContent,
  RedactedThinkingContent,
  ImageContent,
  DocumentContent,
  SearchResultContent,
  ServerToolUseContent,
  WebSearchToolResultContent,
  MCPToolUseContent,
  MCPToolResultContent,
  WebFetchToolResultContent,
  CodeExecutionToolResultContent,
  BashCodeExecutionToolResultContent,
  TextEditorCodeExecutionToolResultContent,
  ToolSearchToolResultContent,
  SessionMetadata,
  ProjectMetadata,
  UserMetadata,
} from "../types";

// ============================================================================
// Message Type Guards
// ============================================================================

export function isUserMessage(message: ClaudeMessage): message is ClaudeUserMessage {
  return message.type === "user";
}

export function isAssistantMessage(message: ClaudeMessage): message is ClaudeAssistantMessage {
  return message.type === "assistant";
}

export function isSystemMessage(message: ClaudeMessage): message is ClaudeSystemMessage {
  return message.type === "system";
}

export function isSummaryMessage(message: ClaudeMessage): message is ClaudeSummaryMessage {
  return message.type === "summary";
}

export function isFileHistoryMessage(message: ClaudeMessage): message is ClaudeFileHistoryMessage {
  return message.type === "file-history-snapshot";
}

export function isProgressMessage(message: ClaudeMessage): message is ClaudeProgressMessage {
  return message.type === "progress";
}

export function isQueueMessage(message: ClaudeMessage): message is ClaudeQueueMessage {
  return message.type === "queue-operation";
}

// ============================================================================
// Content Item Type Guards
// ============================================================================

export function isTextContent(item: ContentItem): item is TextContent {
  return item.type === "text";
}

export function isToolUseContent(item: ContentItem): item is ToolUseContent {
  return item.type === "tool_use";
}

export function isToolResultContent(item: ContentItem): item is ToolResultContent {
  return item.type === "tool_result";
}

export function isThinkingContent(item: ContentItem): item is ThinkingContent {
  return item.type === "thinking";
}

export function isRedactedThinkingContent(item: ContentItem): item is RedactedThinkingContent {
  return item.type === "redacted_thinking";
}

export function isImageContent(item: ContentItem): item is ImageContent {
  return item.type === "image";
}

export function isDocumentContent(item: ContentItem): item is DocumentContent {
  return item.type === "document";
}

export function isSearchResultContent(item: ContentItem): item is SearchResultContent {
  return item.type === "search_result";
}

export function isServerToolUseContent(item: ContentItem): item is ServerToolUseContent {
  return item.type === "server_tool_use";
}

export function isWebSearchToolResultContent(
  item: ContentItem
): item is WebSearchToolResultContent {
  return item.type === "web_search_tool_result";
}

export function isWebFetchToolResultContent(
  item: ContentItem
): item is WebFetchToolResultContent {
  return item.type === "web_fetch_tool_result";
}

export function isCodeExecutionToolResultContent(
  item: ContentItem
): item is CodeExecutionToolResultContent {
  return item.type === "code_execution_tool_result";
}

export function isBashCodeExecutionToolResultContent(
  item: ContentItem
): item is BashCodeExecutionToolResultContent {
  return item.type === "bash_code_execution_tool_result";
}

export function isTextEditorCodeExecutionToolResultContent(
  item: ContentItem
): item is TextEditorCodeExecutionToolResultContent {
  return item.type === "text_editor_code_execution_tool_result";
}

export function isToolSearchToolResultContent(
  item: ContentItem
): item is ToolSearchToolResultContent {
  return item.type === "tool_search_tool_result";
}

export function isMCPToolUseContent(item: ContentItem): item is MCPToolUseContent {
  return item.type === "mcp_tool_use";
}

export function isMCPToolResultContent(item: ContentItem): item is MCPToolResultContent {
  return item.type === "mcp_tool_result";
}

// ============================================================================
// Content Array Type Guard
// ============================================================================

export function isContentArray(content: unknown): content is ContentItem[] {
  return Array.isArray(content);
}

export function isStringContent(content: unknown): content is string {
  return typeof content === "string";
}

// ============================================================================
// Metadata Type Guards
// ============================================================================

export function isSessionMetadataEmpty(metadata: SessionMetadata): boolean {
  return (
    !metadata.customName &&
    !metadata.starred &&
    (!metadata.tags || metadata.tags.length === 0) &&
    !metadata.notes
  );
}

export function isProjectMetadataEmpty(metadata: ProjectMetadata): boolean {
  return !metadata.hidden && !metadata.alias && !metadata.parentProject;
}

export function hasUserMetadata(metadata: UserMetadata | null): metadata is UserMetadata {
  return metadata != null;
}

// ============================================================================
// Tool Result Type Guards
// ============================================================================

export function hasToolUse(message: ClaudeMessage): boolean {
  if (message.type !== "assistant" && message.type !== "user") {
    return false;
  }

  if ("toolUse" in message && message.toolUse != null) {
    return true;
  }

  if (isContentArray(message.content)) {
    return message.content.some((item) => isToolUseContent(item));
  }

  return false;
}

export function hasToolResult(message: ClaudeMessage): boolean {
  if (message.type !== "assistant" && message.type !== "user") {
    return false;
  }

  if ("toolUseResult" in message && message.toolUseResult != null) {
    return true;
  }

  if (isContentArray(message.content)) {
    return message.content.some((item) => isToolResultContent(item));
  }

  return false;
}

// ============================================================================
// Error Checking Type Guards
// ============================================================================

export function hasError(message: ClaudeMessage): boolean {
  if (message.type === "system" && message.level === "error") {
    return true;
  }

  if (isContentArray(message.content)) {
    return message.content.some(
      (item) => isToolResultContent(item) && item.is_error === true
    );
  }

  return false;
}

// ============================================================================
// MCP Type Guards
// ============================================================================

export function hasMCPContent(message: ClaudeMessage): boolean {
  if (!isContentArray(message.content)) {
    return false;
  }

  return message.content.some(
    (item) => isMCPToolUseContent(item) || isMCPToolResultContent(item)
  );
}
