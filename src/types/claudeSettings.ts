/**
 * Claude Code Settings Types
 *
 * Type definitions for Claude Code's settings system.
 * Settings can exist at multiple scopes: user, project, local, and managed.
 */

// ============================================================================
// Model Types
// ============================================================================

/** Supported Claude model variants */
export type ClaudeModel = "opus" | "sonnet" | "haiku";

// ============================================================================
// Permissions Configuration
// ============================================================================

/**
 * Permissions configuration for tool access control
 *
 * Controls which tools and operations Claude Code can execute.
 * Patterns support wildcards (e.g., "Bash(rg:*)", "Read(/path/**)")
 */
export interface PermissionsConfig {
  /** Explicitly allowed tool patterns */
  allow?: string[];
  /** Explicitly denied tool patterns */
  deny?: string[];
  /** Patterns requiring user confirmation */
  ask?: string[];
}

// ============================================================================
// Hooks Configuration
// ============================================================================

/**
 * Hook command to execute at specific lifecycle events
 */
export interface HookCommand {
  /** Command to execute (e.g., "git", "npm") */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Timeout in milliseconds (optional) */
  timeout?: number;
}

/**
 * Lifecycle hooks configuration
 *
 * Hooks execute commands at specific points in Claude Code's lifecycle.
 * Common hooks: UserPromptSubmit, Stop, SessionStart, SessionEnd
 */
export interface HooksConfig {
  /** Executes when user submits a prompt */
  UserPromptSubmit?: HookCommand[];
  /** Executes when session is stopped */
  Stop?: HookCommand[];
  /** Additional custom hooks */
  [key: string]: HookCommand[] | undefined;
}

// ============================================================================
// Status Line Configuration
// ============================================================================

/**
 * Status line display configuration
 *
 * Controls what information is shown in the status line.
 */
export interface StatusLineConfig {
  /** Show current model in status line */
  showModel?: boolean;
  /** Show current project path */
  showProjectPath?: boolean;
  /** Show token usage stats */
  showTokenUsage?: boolean;
  /** Custom status line format */
  format?: string;
}

// ============================================================================
// Marketplace Configuration
// ============================================================================

/**
 * Custom marketplace configuration for MCP servers
 */
export interface MarketplaceConfig {
  /** Marketplace URL */
  url: string;
  /** Display name */
  name?: string;
  /** Marketplace description */
  description?: string;
  /** API key for private marketplaces */
  apiKey?: string;
}

// ============================================================================
// MCP Server Configuration
// ============================================================================

/** MCP server connection type */
export type MCPServerType = "stdio" | "http";

/**
 * Model Context Protocol (MCP) server configuration
 *
 * Defines how to connect to and interact with MCP servers.
 */
export interface MCPServerConfig {
  /** Command to execute (for stdio type) */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  /** Connection type (stdio or http) */
  type?: MCPServerType;
  /** HTTP URL (required if type is "http") */
  url?: string;
  /** Human-readable description */
  description?: string;
}

// ============================================================================
// Feedback Survey State
// ============================================================================

/**
 * Feedback survey state tracking
 *
 * Tracks user feedback survey responses and dismissals.
 */
export interface FeedbackSurveyState {
  /** Survey has been completed */
  completed?: boolean;
  /** Survey has been dismissed */
  dismissed?: boolean;
  /** Last shown timestamp */
  lastShown?: string;
  /** Number of times shown */
  shownCount?: number;
}

// ============================================================================
// Main Settings Interface
// ============================================================================

/**
 * Claude Code settings structure
 *
 * Comprehensive settings for Claude Code behavior, permissions, and integrations.
 */
export interface ClaudeCodeSettings {
  /** JSON Schema reference */
  $schema?: string;

  /** Tool permissions configuration */
  permissions?: PermissionsConfig;

  /** Default model to use */
  model?: ClaudeModel;

  /** Acknowledgement of custom API key responsible use policy */
  customApiKeyResponsibleUseAcknowledged?: boolean;

  /** Lifecycle hooks */
  hooks?: HooksConfig;

  /** Status line configuration */
  statusLine?: StatusLineConfig;

  /** Enabled plugin list */
  enabledPlugins?: Record<string, boolean>;

  /** Custom MCP server marketplaces */
  extraKnownMarketplaces?: Record<string, MarketplaceConfig>;

  /** MCP server configurations */
  mcpServers?: Record<string, MCPServerConfig>;

  /** Feedback survey state */
  feedbackSurveyState?: FeedbackSurveyState;

  /** Environment variables */
  env?: Record<string, string>;
}

// ============================================================================
// Settings Scope
// ============================================================================

/**
 * Settings scope hierarchy
 *
 * - user: Global user settings (~/.claude/settings.json)
 * - project: Project-level settings (.claude/settings.json)
 * - local: Local overrides (.claude/settings.local.json)
 * - managed: System-managed settings (highest priority)
 */
export type SettingsScope = "user" | "project" | "local" | "managed";

/**
 * Scope priority for settings merging
 *
 * Higher values take precedence when merging settings.
 */
export const SCOPE_PRIORITY: Record<SettingsScope, number> = {
  managed: 100,
  local: 30,
  project: 20,
  user: 10,
};

// ============================================================================
// Settings Response Types
// ============================================================================

/**
 * All settings response from backend
 *
 * Returns raw JSON strings for each scope level.
 * Null indicates the settings file doesn't exist at that scope.
 */
export interface AllSettingsResponse {
  /** User-level settings JSON */
  user: string | null;
  /** Project-level settings JSON */
  project: string | null;
  /** Local settings JSON */
  local: string | null;
  /** Managed settings JSON */
  managed: string | null;
}

/**
 * MCP servers source type
 *
 * Legacy sources:
 * - user_settings: ~/.claude/settings.json mcpServers field
 * - user_mcp: ~/.claude/.mcp.json
 * - project_mcp: <project>/.mcp.json
 *
 * Official sources (from ~/.claude.json):
 * - user_claude_json: ~/.claude.json mcpServers (user-scoped, cross-project)
 * - local_claude_json: ~/.claude.json projects.<path>.mcpServers (local-scoped, project-specific)
 */
export type MCPSource =
  | "user_settings"
  | "user_mcp"
  | "project_mcp"
  | "user_claude_json"
  | "local_claude_json";

/**
 * All MCP servers from all sources
 */
export interface AllMCPServersResponse {
  /** MCP servers from ~/.claude/settings.json mcpServers field (legacy) */
  userSettings: Record<string, MCPServerConfig> | null;
  /** MCP servers from ~/.claude/.mcp.json (legacy) */
  userMcpFile: Record<string, MCPServerConfig> | null;
  /** MCP servers from <project>/.mcp.json */
  projectMcpFile: Record<string, MCPServerConfig> | null;
  /** MCP servers from ~/.claude.json mcpServers (official user-scoped) */
  userClaudeJson: Record<string, MCPServerConfig> | null;
  /** MCP servers from ~/.claude.json projects.<path>.mcpServers (official local-scoped) */
  localClaudeJson: Record<string, MCPServerConfig> | null;
}

/**
 * Claude.json full configuration response
 */
export interface ClaudeJsonConfigResponse {
  /** Full raw JSON content */
  raw: Record<string, unknown>;
  /** User-scoped MCP servers */
  mcpServers: Record<string, MCPServerConfig> | null;
  /** Project settings from projects.<path> */
  projectSettings: ClaudeJsonProjectSettings | null;
  /** File path for reference */
  filePath: string;
}

/**
 * Project-specific settings from ~/.claude.json projects.<path>
 */
export interface ClaudeJsonProjectSettings {
  /** Allowed tools for this project */
  allowedTools?: string[];
  /** Skip directory crawling */
  dontCrawlDirectory?: boolean;
  /** MCP context URIs */
  mcpContextUris?: string[];
  /** MCP servers for this project */
  mcpServers?: Record<string, MCPServerConfig>;
  /** Enabled .mcp.json servers */
  enabledMcpjsonServers?: string[];
  /** Disabled .mcp.json servers */
  disabledMcpjsonServers?: string[];
  /** Disabled MCP servers */
  disabledMcpServers?: string[];
  /** Trust dialog accepted */
  hasTrustDialogAccepted?: boolean;
  /** Ignore patterns */
  ignorePatterns?: string[];
  /** Example files */
  exampleFiles?: string[];
  /** Other arbitrary fields */
  [key: string]: unknown;
}

/**
 * Parsed settings with scope metadata
 *
 * Represents parsed settings from a specific scope with metadata.
 */
export interface ScopedSettings {
  /** Settings scope level */
  scope: SettingsScope;
  /** Parsed settings object */
  settings: ClaudeCodeSettings;
  /** Full file path to the settings file */
  filePath: string;
  /** Whether the settings file exists */
  exists: boolean;
}

// ============================================================================
// Settings Preset
// ============================================================================

/**
 * Settings preset for saving/loading configurations
 *
 * Allows users to save and load named settings configurations.
 */
export interface SettingsPreset {
  /** Unique preset identifier */
  id: string;
  /** Human-readable preset name */
  name: string;
  /** Preset description */
  description?: string;
  /** Partial settings to apply */
  settings: Partial<ClaudeCodeSettings>;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}
