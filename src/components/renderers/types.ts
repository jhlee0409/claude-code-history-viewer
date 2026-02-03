/**
 * Shared types for all renderer components
 *
 * This file provides centralized type definitions to ensure consistency
 * across all renderer components and simplify LLM maintenance.
 */

/**
 * Base props shared by all renderer components
 */
export interface BaseRendererProps {
  /** Additional CSS class names */
  className?: string;
  /** Enable collapsible toggle behavior */
  enableToggle?: boolean;
  /** Default expanded state (for collapsible renderers) */
  defaultExpanded?: boolean;
  /** Search query for highlighting matches */
  searchQuery?: string;
  /** Whether this item contains the current search match */
  isCurrentMatch?: boolean;
  /** Index of current match within the message */
  currentMatchIndex?: number;
}

/**
 * Props for tool-related renderers
 */
export interface ToolRendererProps extends BaseRendererProps {
  /** Tool use ID for tracking */
  toolId?: string;
  /** Tool input parameters */
  input?: Record<string, unknown>;
}

/**
 * Props for renderers that display indexed content
 */
export interface IndexedRendererProps extends BaseRendererProps {
  /** Index of this item in a list */
  index: number;
}

/**
 * Tool use content from Claude API
 */
export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content from Claude API
 */
export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string | unknown[];
  is_error?: boolean;
}

/**
 * Semantic categories for renderer styling
 * Industrial Luxury color palette with distinct purpose for each category
 */
export type RendererVariant =
  | "success"   // Successful operations (file created, command passed)
  | "info"      // Informational content (tool use, task descriptions)
  | "warning"   // Warnings and system reminders
  | "error"     // Errors and failures
  | "neutral"   // Default/neutral content
  | "code"      // Code-related operations (Read, Write, Edit) - Blue
  | "file"      // File operations (Glob, file search) - Teal
  | "search"    // Search operations (Grep) - Violet
  | "task"      // Task management (TodoWrite, Task) - Amber
  | "system"    // System operations (Bash, terminal) - Orange
  | "thinking"  // Thinking/reasoning blocks - Gold
  | "git"       // Git operations - Cyan
  | "web"       // Web operations (WebSearch, WebFetch) - Sky Blue
  | "mcp"       // MCP/Server operations - Magenta
  | "document"  // Document operations (PDF, text) - Teal
  | "terminal"; // Terminal/Shell output - Warm Orange

/**
 * Tool name to variant mapping
 * Each tool is mapped to its semantic category for consistent styling
 */
export const TOOL_VARIANTS: Record<string, RendererVariant> = {
  // Code operations (Blue)
  Read: "code",
  Write: "code",
  Edit: "code",
  MultiEdit: "code",
  NotebookEdit: "code",
  LSP: "code",

  // File operations (Teal)
  Glob: "file",
  LS: "file",

  // Search operations (Violet)
  Grep: "search",

  // Web operations (Sky Blue)
  WebSearch: "web",
  WebFetch: "web",
  web_search: "web",

  // Task management (Amber)
  Task: "task",
  TodoWrite: "task",
  TodoRead: "task",

  // Terminal/Shell operations
  Bash: "terminal",
  KillShell: "terminal",

  // Git operations (Cyan)
  git: "git",

  // MCP/Server operations (Magenta)
  mcp: "mcp",

  // Default
  default: "info",
} as const;

/**
 * File metadata extracted from tool results
 */
export interface FileMetadata {
  filePath: string;
  content?: string;
  numLines?: number;
  startLine?: number;
  totalLines?: number;
}

/**
 * Command execution result
 */
export interface CommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  interrupted?: boolean;
  isImage?: boolean;
}

/**
 * Detected programming language
 */
export type ProgrammingLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "php"
  | "ruby"
  | "json"
  | "yaml"
  | "markdown"
  | "html"
  | "css"
  | "shell"
  | "text";
