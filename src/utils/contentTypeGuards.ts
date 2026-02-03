/**
 * Content Type Guards Utility
 *
 * Comprehensive runtime type checking for all Claude content types.
 * These guards accept `unknown` for flexible runtime validation,
 * complementing the ContentItem-specific guards in typeGuards.ts.
 *
 * @see src/utils/typeGuards.ts for message-level type guards
 */

import type {
  ContentItem,
  TextContent,
  ThinkingContent,
  RedactedThinkingContent,
  ImageContent,
  DocumentContent,
  SearchResultContent,
  ToolUseContent,
  ToolResultContent,
  ServerToolUseContent,
  WebSearchToolResultContent,
  WebFetchToolResultContent,
  CodeExecutionToolResultContent,
  BashCodeExecutionToolResultContent,
  TextEditorCodeExecutionToolResultContent,
  ToolSearchToolResultContent,
  MCPToolUseContent,
  MCPToolResultContent,
  Base64ImageSource,
  URLImageSource,
  Base64PDFSource,
  PlainTextSource,
  URLPDFSource,
} from "../types";

// ============================================================================
// Base Content Type Guard
// ============================================================================

/**
 * Base type guard - checks if value is a valid content item structure
 */
export function isContentItem(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === "object" && "type" in item;
}

// ============================================================================
// Content Type Extractor
// ============================================================================

/**
 * Safely extracts the content type from an unknown value
 * @returns The content type string, or null if invalid
 */
export function getContentType(item: unknown): string | null {
  if (!isContentItem(item)) return null;
  return typeof item.type === "string" ? item.type : null;
}

// ============================================================================
// Basic Content Type Guards
// ============================================================================

/**
 * Type guard for text content blocks
 */
export function isTextContent(item: unknown): item is TextContent {
  return (
    isContentItem(item) &&
    item.type === "text" &&
    typeof (item as Record<string, unknown>).text === "string"
  );
}

/**
 * Type guard for thinking content blocks
 */
export function isThinkingContent(item: unknown): item is ThinkingContent {
  return (
    isContentItem(item) &&
    item.type === "thinking" &&
    typeof (item as Record<string, unknown>).thinking === "string"
  );
}

/**
 * Type guard for redacted thinking content blocks
 */
export function isRedactedThinkingContent(item: unknown): item is RedactedThinkingContent {
  return (
    isContentItem(item) &&
    item.type === "redacted_thinking" &&
    typeof (item as Record<string, unknown>).data === "string"
  );
}

// ============================================================================
// Image Type Guards
// ============================================================================

/**
 * Type guard for image content blocks
 */
export function isImageContent(item: unknown): item is ImageContent {
  return (
    isContentItem(item) &&
    item.type === "image" &&
    "source" in item &&
    item.source !== null &&
    typeof item.source === "object"
  );
}

/**
 * Type guard for base64 image sources
 */
export function isBase64ImageSource(source: unknown): source is Base64ImageSource {
  return (
    source !== null &&
    typeof source === "object" &&
    "type" in source &&
    source.type === "base64" &&
    "media_type" in source &&
    typeof (source as Record<string, unknown>).media_type === "string" &&
    "data" in source &&
    typeof (source as Record<string, unknown>).data === "string"
  );
}

/**
 * Type guard for URL image sources
 */
export function isURLImageSource(source: unknown): source is URLImageSource {
  return (
    source !== null &&
    typeof source === "object" &&
    "type" in source &&
    source.type === "url" &&
    "url" in source &&
    typeof (source as Record<string, unknown>).url === "string"
  );
}

// ============================================================================
// Document Type Guards
// ============================================================================

/**
 * Type guard for document content blocks
 */
export function isDocumentContent(item: unknown): item is DocumentContent {
  return (
    isContentItem(item) &&
    item.type === "document" &&
    "source" in item &&
    item.source !== null &&
    typeof item.source === "object"
  );
}

/**
 * Type guard for base64 PDF sources
 */
export function isBase64PDFSource(source: unknown): source is Base64PDFSource {
  return (
    source !== null &&
    typeof source === "object" &&
    "type" in source &&
    source.type === "base64" &&
    "media_type" in source &&
    (source as Record<string, unknown>).media_type === "application/pdf" &&
    "data" in source &&
    typeof (source as Record<string, unknown>).data === "string"
  );
}

/**
 * Type guard for plain text sources
 */
export function isPlainTextSource(source: unknown): source is PlainTextSource {
  return (
    source !== null &&
    typeof source === "object" &&
    "type" in source &&
    source.type === "text" &&
    "media_type" in source &&
    (source as Record<string, unknown>).media_type === "text/plain" &&
    "data" in source &&
    typeof (source as Record<string, unknown>).data === "string"
  );
}

/**
 * Type guard for URL PDF sources
 */
export function isURLPDFSource(source: unknown): source is URLPDFSource {
  return (
    source !== null &&
    typeof source === "object" &&
    "type" in source &&
    source.type === "url" &&
    "url" in source &&
    typeof (source as Record<string, unknown>).url === "string"
  );
}

// ============================================================================
// Search Result Type Guard
// ============================================================================

/**
 * Type guard for search result content blocks
 */
export function isSearchResultContent(item: unknown): item is SearchResultContent {
  return (
    isContentItem(item) &&
    item.type === "search_result" &&
    "title" in item &&
    typeof (item as Record<string, unknown>).title === "string" &&
    "source" in item &&
    typeof (item as Record<string, unknown>).source === "string" &&
    "content" in item &&
    Array.isArray((item as Record<string, unknown>).content)
  );
}

// ============================================================================
// Tool Use Type Guards
// ============================================================================

/**
 * Type guard for tool use content blocks
 */
export function isToolUseContent(item: unknown): item is ToolUseContent {
  return (
    isContentItem(item) &&
    item.type === "tool_use" &&
    "id" in item &&
    typeof (item as Record<string, unknown>).id === "string" &&
    "name" in item &&
    typeof (item as Record<string, unknown>).name === "string" &&
    "input" in item &&
    item.input !== null &&
    typeof item.input === "object"
  );
}

/**
 * Type guard for tool result content blocks
 */
export function isToolResultContent(item: unknown): item is ToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item &&
    typeof (item as Record<string, unknown>).content === "string"
  );
}

/**
 * Type guard for server-side tool use content blocks
 */
export function isServerToolUseContent(item: unknown): item is ServerToolUseContent {
  return (
    isContentItem(item) &&
    item.type === "server_tool_use" &&
    "id" in item &&
    typeof (item as Record<string, unknown>).id === "string" &&
    "name" in item &&
    typeof (item as Record<string, unknown>).name === "string" &&
    "input" in item &&
    item.input !== null &&
    typeof item.input === "object"
  );
}

// ============================================================================
// Web Search Type Guard
// ============================================================================

/**
 * Type guard for web search tool result content blocks
 */
export function isWebSearchToolResultContent(
  item: unknown
): item is WebSearchToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "web_search_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

// ============================================================================
// Web Fetch Type Guard (beta: web-fetch-2025-09-10)
// ============================================================================

/**
 * Type guard for web fetch tool result content blocks
 */
export function isWebFetchToolResultContent(
  item: unknown
): item is WebFetchToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "web_fetch_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

// ============================================================================
// Code Execution Type Guards (beta: code-execution-2025-08-25)
// ============================================================================

/**
 * Type guard for legacy Python code execution tool result content blocks
 */
export function isCodeExecutionToolResultContent(
  item: unknown
): item is CodeExecutionToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "code_execution_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

/**
 * Type guard for Bash code execution tool result content blocks
 */
export function isBashCodeExecutionToolResultContent(
  item: unknown
): item is BashCodeExecutionToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "bash_code_execution_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

/**
 * Type guard for text editor code execution tool result content blocks
 */
export function isTextEditorCodeExecutionToolResultContent(
  item: unknown
): item is TextEditorCodeExecutionToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "text_editor_code_execution_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

// ============================================================================
// Tool Search Type Guard (beta: mcp-client-2025-11-20)
// ============================================================================

/**
 * Type guard for tool search tool result content blocks
 */
export function isToolSearchToolResultContent(
  item: unknown
): item is ToolSearchToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "tool_search_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

// ============================================================================
// MCP Type Guards
// ============================================================================

/**
 * Type guard for MCP tool use content blocks
 */
export function isMCPToolUseContent(item: unknown): item is MCPToolUseContent {
  return (
    isContentItem(item) &&
    item.type === "mcp_tool_use" &&
    "id" in item &&
    typeof (item as Record<string, unknown>).id === "string" &&
    "server_name" in item &&
    typeof (item as Record<string, unknown>).server_name === "string" &&
    "tool_name" in item &&
    typeof (item as Record<string, unknown>).tool_name === "string" &&
    "input" in item &&
    item.input !== null &&
    typeof item.input === "object"
  );
}

/**
 * Type guard for MCP tool result content blocks
 */
export function isMCPToolResultContent(item: unknown): item is MCPToolResultContent {
  return (
    isContentItem(item) &&
    item.type === "mcp_tool_result" &&
    "tool_use_id" in item &&
    typeof (item as Record<string, unknown>).tool_use_id === "string" &&
    "content" in item
  );
}

// ============================================================================
// Generic Extractor Factory
// ============================================================================

/**
 * Creates a type-safe extractor function for a given type guard
 *
 * @template T The content type to extract
 * @param typeGuard The type guard function to use
 * @returns A function that extracts the content if it matches, or null
 *
 * @example
 * ```typescript
 * const extractText = createExtractor(isTextContent);
 * const text = extractText(unknownContent); // TextContent | null
 * ```
 */
export function createExtractor<T>(
  typeGuard: (item: unknown) => item is T
): (item: unknown) => T | null {
  return (item) => (typeGuard(item) ? item : null);
}

// ============================================================================
// Pre-built Extractors
// ============================================================================

/** Extract text content from unknown value */
export const extractTextContent = createExtractor(isTextContent);

/** Extract thinking content from unknown value */
export const extractThinkingContent = createExtractor(isThinkingContent);

/** Extract redacted thinking content from unknown value */
export const extractRedactedThinkingContent = createExtractor(isRedactedThinkingContent);

/** Extract image content from unknown value */
export const extractImageContent = createExtractor(isImageContent);

/** Extract document content from unknown value */
export const extractDocumentContent = createExtractor(isDocumentContent);

/** Extract search result content from unknown value */
export const extractSearchResultContent = createExtractor(isSearchResultContent);

/** Extract tool use content from unknown value */
export const extractToolUseContent = createExtractor(isToolUseContent);

/** Extract tool result content from unknown value */
export const extractToolResultContent = createExtractor(isToolResultContent);

/** Extract server tool use content from unknown value */
export const extractServerToolUseContent = createExtractor(isServerToolUseContent);

/** Extract web search tool result content from unknown value */
export const extractWebSearchToolResultContent = createExtractor(isWebSearchToolResultContent);

/** Extract web fetch tool result content from unknown value */
export const extractWebFetchToolResultContent = createExtractor(isWebFetchToolResultContent);

/** Extract code execution tool result content from unknown value */
export const extractCodeExecutionToolResultContent = createExtractor(
  isCodeExecutionToolResultContent
);

/** Extract Bash code execution tool result content from unknown value */
export const extractBashCodeExecutionToolResultContent = createExtractor(
  isBashCodeExecutionToolResultContent
);

/** Extract text editor code execution tool result content from unknown value */
export const extractTextEditorCodeExecutionToolResultContent = createExtractor(
  isTextEditorCodeExecutionToolResultContent
);

/** Extract tool search tool result content from unknown value */
export const extractToolSearchToolResultContent = createExtractor(isToolSearchToolResultContent);

/** Extract MCP tool use content from unknown value */
export const extractMCPToolUseContent = createExtractor(isMCPToolUseContent);

/** Extract MCP tool result content from unknown value */
export const extractMCPToolResultContent = createExtractor(isMCPToolResultContent);

// ============================================================================
// Multi-Type Filtering
// ============================================================================

/**
 * Filters an array to extract all content items of a specific type
 *
 * @template T The content type to filter for
 * @param items Array of unknown items to filter
 * @param typeGuard The type guard to use for filtering
 * @returns Array containing only items that match the type guard
 *
 * @example
 * ```typescript
 * const textItems = filterContentByType(content, isTextContent);
 * // Returns only TextContent items
 * ```
 */
export function filterContentByType<T extends ContentItem>(
  items: unknown[],
  typeGuard: (item: unknown) => item is T
): T[] {
  return items.filter(typeGuard);
}

/**
 * Finds the first content item of a specific type in an array
 *
 * @template T The content type to find
 * @param items Array of unknown items to search
 * @param typeGuard The type guard to use for matching
 * @returns The first matching item, or null if none found
 *
 * @example
 * ```typescript
 * const firstThinking = findContentByType(content, isThinkingContent);
 * ```
 */
export function findContentByType<T extends ContentItem>(
  items: unknown[],
  typeGuard: (item: unknown) => item is T
): T | null {
  const found = items.find(typeGuard);
  return found !== undefined ? found : null;
}

/**
 * Checks if an array contains any content of a specific type
 *
 * @param items Array of unknown items to check
 * @param typeGuard The type guard to use for matching
 * @returns True if at least one item matches the type guard
 *
 * @example
 * ```typescript
 * const hasImages = hasContentOfType(content, isImageContent);
 * ```
 */
export function hasContentOfType(
  items: unknown[],
  typeGuard: (item: unknown) => boolean
): boolean {
  return items.some(typeGuard);
}
