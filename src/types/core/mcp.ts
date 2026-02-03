/**
 * Core MCP Types (Model Context Protocol)
 *
 * Types for MCP server tool invocations and results.
 */

import type { ImageMimeType } from "./content";

// ============================================================================
// MCP Tool Use
// ============================================================================

/** MCP tool use - server-side tool invocation via MCP */
export interface MCPToolUseContent {
  type: "mcp_tool_use";
  id: string;
  server_name: string;
  tool_name: string;
  input: Record<string, unknown>;
}

// ============================================================================
// MCP Tool Result
// ============================================================================

/** MCP tool result - response from MCP server tool */
export interface MCPToolResultContent {
  type: "mcp_tool_result";
  tool_use_id: string;
  content: MCPToolResultData | string;
  is_error?: boolean;
}

/** MCP tool result data - discriminated union for type safety */
export type MCPToolResultData =
  | MCPTextResult
  | MCPImageResult
  | MCPResourceResult
  | MCPUnknownResult;

export interface MCPTextResult {
  type: "text";
  text: string;
}

export interface MCPImageResult {
  type: "image";
  data: string;
  mimeType: ImageMimeType;
}

export interface MCPResourceResult {
  type: "resource";
  uri: string;
}

export interface MCPUnknownResult {
  type?: undefined;
  [key: string]: unknown;
}

// ============================================================================
// Claude MCP Result (legacy format)
// ============================================================================

export interface ClaudeMCPResult {
  server: string;
  method: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string;
}
