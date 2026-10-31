/**
 * Core Tool Types
 *
 * Tool use and tool result content types for Claude's tool interactions.
 * Includes server-side tools, web search, web fetch, and code execution.
 */

import type { TextContent } from "./content";

// ============================================================================
// Basic Tool Types
// ============================================================================

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolUseResultSource {
  messageUuid: string;
  sessionId: string;
  contentIndex: number;
  /** Source-record association, not proof of matching call identity or status. */
  association: "single_result" | "unassigned";
  resultContentIndices?: number[];
  unassignedToolUseResult?: unknown;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  /** Exact source JSON; absent/null/false/zero/empty are distinct. */
  toolUseResult?: unknown;
  toolUseResultSource?: ToolUseResultSource;
  /** Exact plain Codex wrapper and optional producer-header exit, before merge. */
  codexOutput?: { raw: string; sourceMessageUuid: string; exitCode?: number };
  /** The result's own producer turn, independent of the matched call. */
  codexEvidence?: unknown;
}

export interface ClaudeToolUseResult {
  command: string;
  stream: string;
  output: string;
  timestamp: string;
  exitCode: number;
}

// ============================================================================
// Server-Side Tool Types
// ============================================================================

/** Server-side tool use (e.g., web_search) */
export interface ServerToolUseContent {
  type: "server_tool_use";
  id: string;
  name: "web_search" | string;
  input: Record<string, unknown>;
}

// ============================================================================
// Web Search Types
// ============================================================================

export interface WebSearchToolResultContent {
  type: "web_search_tool_result";
  tool_use_id: string;
  content: WebSearchResultItem[] | WebSearchToolError;
}

export interface WebSearchResultItem {
  type: "web_search_result";
  title: string;
  url: string;
  encrypted_content?: string;
  page_age?: string;
}

export interface WebSearchToolError {
  type: "error";
  error_code: string;
  message: string;
}

// ============================================================================
// Web Fetch Types (beta: web-fetch-2025-09-10)
// ============================================================================

export interface WebFetchToolResultContent {
  type: "web_fetch_tool_result";
  tool_use_id: string;
  content: WebFetchResult | WebFetchError;
}

export interface WebFetchResult {
  type: "web_fetch_result";
  url: string;
  content?: {
    type: "document";
    source?: {
      type: "base64" | "text" | "url";
      media_type?: string;
      data?: string;
      url?: string;
    };
    title?: string;
  };
  retrieved_at?: string;
}

export interface WebFetchError {
  type: "web_fetch_tool_error";
  error_code:
    | "invalid_input"
    | "url_too_long"
    | "url_not_allowed"
    | "url_not_accessible"
    | "too_many_requests"
    | "unsupported_content_type"
    | "max_uses_exceeded"
    | "unavailable";
}

// ============================================================================
// Code Execution Types (beta: code-execution-2025-08-25)
// ============================================================================

/** Legacy Python code execution result */
export interface CodeExecutionToolResultContent {
  type: "code_execution_tool_result";
  tool_use_id: string;
  content: CodeExecutionResult | CodeExecutionError;
}

export interface CodeExecutionResult {
  type: "code_execution_result";
  stdout?: string;
  stderr?: string;
  return_code?: number;
}

export interface CodeExecutionError {
  type: "code_execution_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "execution_time_exceeded";
}

/** Bash code execution result */
export interface BashCodeExecutionToolResultContent {
  type: "bash_code_execution_tool_result";
  tool_use_id: string;
  content: BashCodeExecutionResult | BashCodeExecutionError;
}

export interface BashCodeExecutionResult {
  type: "bash_code_execution_result";
  stdout?: string;
  stderr?: string;
  return_code?: number;
}

export interface BashCodeExecutionError {
  type: "bash_code_execution_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "execution_time_exceeded";
}

/** Text editor code execution result */
export interface TextEditorCodeExecutionToolResultContent {
  type: "text_editor_code_execution_tool_result";
  tool_use_id: string;
  content: TextEditorResult | TextEditorError;
}

/** SDK cb5fba419808e3844fa6407e59577ab7ba346b79 messages.ts:7085-7192.
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7085-L7192 */
export type TextEditorResult =
  | { type: "text_editor_code_execution_create_result"; is_file_update: boolean }
  | { type: "text_editor_code_execution_view_result"; content: string; file_type: "text" | "image" | "pdf"; num_lines: number | null; start_line: number | null; total_lines: number | null }
  | { type: "text_editor_code_execution_str_replace_result"; lines: string[] | null; new_lines: number | null; new_start: number | null; old_lines: number | null; old_start: number | null };

export interface TextEditorError {
  type: "text_editor_code_execution_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "execution_time_exceeded"
    | "file_not_found";
  error_message: string | null;
}

// ============================================================================
// Tool Search Types (beta: mcp-client-2025-11-20)
// ============================================================================

export interface ToolSearchToolResultContent {
  type: "tool_search_tool_result";
  tool_use_id: string;
  content: ToolSearchResult | ToolSearchError;
}

/** https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L8010-L8057 */
export interface ToolSearchResult {
  type: "tool_search_tool_search_result";
  tool_references: { type: "tool_reference"; tool_name: string }[];
}

export interface ToolSearchError {
  type: "tool_search_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "execution_time_exceeded";
  error_message: string | null;
}

/**
 * Result block of the server-side "advisor" tool. The matching request is a
 * `server_tool_use` (name "advisor"); this is the result returned to the model.
 */
export interface AdvisorToolResultContent {
  type: "advisor_tool_result";
  tool_use_id: string;
  content: AdvisorResult | AdvisorError;
}

/** SDK messages.ts:360-405,470-476; encrypted content is opaque, never advice text.
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L360-L405 */
export type AdvisorResult =
  | { type: "advisor_result"; text: string; stop_reason?: string | null }
  | { type: "advisor_redacted_result"; encrypted_content: string; stop_reason?: string | null };

export interface AdvisorError {
  type: "advisor_tool_result_error";
  error_code: string;
}

// ============================================================================
// Content Item Union (all possible content types)
// ============================================================================

import type {
  ThinkingContent,
  RedactedThinkingContent,
  ImageContent,
  DocumentContent,
  SearchResultContent,
  ContainerUploadContent,
} from "./content";

import type { MCPToolUseContent, MCPToolResultContent } from "./mcp";

export type ContentItem =
  | TextContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent
  | RedactedThinkingContent
  | ServerToolUseContent
  | WebSearchToolResultContent
  | WebFetchToolResultContent
  | CodeExecutionToolResultContent
  | BashCodeExecutionToolResultContent
  | TextEditorCodeExecutionToolResultContent
  | ToolSearchToolResultContent
  | AdvisorToolResultContent
  | ImageContent
  | DocumentContent
  | SearchResultContent
  | MCPToolUseContent
  | MCPToolResultContent
  | ContainerUploadContent;
