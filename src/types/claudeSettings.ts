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
 * Default permission mode
 * - acceptEdits: Auto-accept file edits
 * - askPermissions: Prompt for all permissions
 * - viewOnly: Read-only mode (no writes)
 */
export type PermissionDefaultMode = "acceptEdits" | "askPermissions" | "viewOnly";

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
  /** Additional directories Claude can access */
  additionalDirectories?: string[];
  /** Default permission mode */
  defaultMode?: PermissionDefaultMode;
  /** Disable bypass permissions mode */
  disableBypassPermissionsMode?: "disable";
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
 * Can be a static config or command-based dynamic status.
 */
export interface StatusLineConfig {
  /** Config type: static or command */
  type?: "static" | "command";
  /** Show current model in status line */
  showModel?: boolean;
  /** Show current project path */
  showProjectPath?: boolean;
  /** Show token usage stats */
  showTokenUsage?: boolean;
  /** Custom status line format */
  format?: string;
  /** Command to execute for dynamic status (when type is "command") */
  command?: string;
}

// ============================================================================
// Sandbox Configuration
// ============================================================================

/**
 * Network sandbox configuration
 */
export interface SandboxNetworkConfig {
  /** Unix sockets that can be accessed */
  allowUnixSockets?: string[];
  /** Allow localhost port binding (macOS only) */
  allowLocalBinding?: boolean;
  /** HTTP proxy port */
  httpProxyPort?: number;
  /** SOCKS5 proxy port */
  socksProxyPort?: number;
}

/**
 * Sandbox configuration for bash command isolation
 *
 * Provides security isolation for bash commands on macOS/Linux/WSL2.
 */
export interface SandboxConfig {
  /** Enable sandbox mode */
  enabled?: boolean;
  /** Auto-approve bash commands when sandboxed */
  autoAllowBashIfSandboxed?: boolean;
  /** Commands that run outside sandbox */
  excludedCommands?: string[];
  /** Allow unsandboxed command escape hatch */
  allowUnsandboxedCommands?: boolean;
  /** Network configuration */
  network?: SandboxNetworkConfig;
  /** Enable weaker sandbox for unprivileged Docker */
  enableWeakerNestedSandbox?: boolean;
}

// ============================================================================
// Attribution Configuration
// ============================================================================

/**
 * Attribution settings for git commits and PRs
 */
export interface AttributionConfig {
  /** Git commit attribution (empty string = no attribution) */
  commit?: string;
  /** PR description attribution */
  pr?: string;
}

// ============================================================================
// Auto-Update Configuration
// ============================================================================

/** Auto-update release channel */
export type AutoUpdatesChannel = "stable" | "latest";

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
 * Based on official Claude Code documentation as of 2025.
 */
export interface ClaudeCodeSettings {
  /** JSON Schema reference */
  $schema?: string;

  // -------------------------------------------------------------------------
  // Core Settings
  // -------------------------------------------------------------------------

  /** Default model to use (opus, sonnet, haiku) */
  model?: ClaudeModel;

  /** Claude's preferred response language (e.g., "english", "korean", "japanese") */
  language?: string;

  /** Output style adjustment for system prompt */
  outputStyle?: string;

  /** Days before inactive sessions are deleted (0 = immediate, default: 30) */
  cleanupPeriodDays?: number;

  /** Enable extended thinking by default */
  alwaysThinkingEnabled?: boolean;

  /** Auto-update release channel (stable or latest) */
  autoUpdatesChannel?: AutoUpdatesChannel;

  /** Path for plan files (default: ~/.claude/plans) */
  plansDirectory?: string;

  /** Exclude .gitignore files from suggestions (default: true) */
  respectGitignore?: boolean;

  /** Show turn duration messages (default: true) */
  showTurnDuration?: boolean;

  /** Show tips in spinner (default: true) */
  spinnerTipsEnabled?: boolean;

  /** Enable terminal progress bar (default: true) */
  terminalProgressBarEnabled?: boolean;

  // -------------------------------------------------------------------------
  // API & Authentication
  // -------------------------------------------------------------------------

  /** Custom script to generate auth value */
  apiKeyHelper?: string;

  /** Acknowledgement of custom API key responsible use policy */
  customApiKeyResponsibleUseAcknowledged?: boolean;

  /** Script for dynamic OpenTelemetry headers */
  otelHeadersHelper?: string;

  // -------------------------------------------------------------------------
  // Attribution
  // -------------------------------------------------------------------------

  /** Attribution settings for commits and PRs */
  attribution?: AttributionConfig;

  /** @deprecated Use attribution.commit instead */
  includeCoAuthoredBy?: boolean;

  // -------------------------------------------------------------------------
  // Permissions & Security
  // -------------------------------------------------------------------------

  /** Tool permissions configuration */
  permissions?: PermissionsConfig;

  /** Sandbox configuration for bash isolation */
  sandbox?: SandboxConfig;

  /** Disable all hooks */
  disableAllHooks?: boolean;

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  /** Lifecycle hooks */
  hooks?: HooksConfig;

  // -------------------------------------------------------------------------
  // UI Customization
  // -------------------------------------------------------------------------

  /** Status line configuration */
  statusLine?: StatusLineConfig;

  /** Custom file suggestion script for @ autocomplete */
  fileSuggestion?: { type: "command"; command: string };

  // -------------------------------------------------------------------------
  // MCP & Plugins
  // -------------------------------------------------------------------------

  /** MCP server configurations */
  mcpServers?: Record<string, MCPServerConfig>;

  /** Auto-approve all .mcp.json servers */
  enableAllProjectMcpServers?: boolean;

  /** Whitelist specific MCP servers from .mcp.json */
  enabledMcpjsonServers?: string[];

  /** Blacklist specific MCP servers from .mcp.json */
  disabledMcpjsonServers?: string[];

  /** Enabled plugin list */
  enabledPlugins?: Record<string, boolean>;

  /** Custom MCP server marketplaces */
  extraKnownMarketplaces?: Record<string, MarketplaceConfig>;

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  /** Environment variables for sessions */
  env?: Record<string, string>;

  // -------------------------------------------------------------------------
  // Announcements (Managed scope)
  // -------------------------------------------------------------------------

  /** Startup announcements (randomly cycled) */
  companyAnnouncements?: string[];

  // -------------------------------------------------------------------------
  // Internal State (not for direct editing)
  // -------------------------------------------------------------------------

  /** Feedback survey state */
  feedbackSurveyState?: FeedbackSurveyState;
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
