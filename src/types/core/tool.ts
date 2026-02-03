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

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
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

export interface TextEditorResult {
  type: "text_editor_code_execution_result";
  operation?: "view" | "create" | "edit" | "delete";
  path?: string;
  content?: string;
  old_content?: string;
  new_content?: string;
  success?: boolean;
}

export interface TextEditorError {
  type: "text_editor_code_execution_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "execution_time_exceeded"
    | "file_not_found"
    | "permission_denied";
}

// ============================================================================
// Tool Search Types (beta: mcp-client-2025-11-20)
// ============================================================================

export interface ToolSearchToolResultContent {
  type: "tool_search_tool_result";
  tool_use_id: string;
  content: ToolSearchResult[] | ToolSearchError;
}

export interface ToolSearchResult {
  type: "tool_search_tool_search_result";
  tool_name: string;
  server_name?: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface ToolSearchError {
  type: "tool_search_tool_result_error";
  error_code:
    | "invalid_tool_input"
    | "unavailable"
    | "too_many_requests"
    | "no_results";
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
  | ImageContent
  | DocumentContent
  | SearchResultContent
  | MCPToolUseContent
  | MCPToolResultContent;
