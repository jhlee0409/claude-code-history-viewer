/**
 * SettingsManager Constants
 *
 * Centralized constants for the Settings Manager component.
 */

// ============================================================================
// Layout Constants
// ============================================================================

/** Maximum height for dialog content */
export const DIALOG_MAX_HEIGHT = "80vh";

/** Maximum height for project list in selector */
export const PROJECT_LIST_MAX_HEIGHT = "55vh";

/** Sidebar width */
export const SIDEBAR_WIDTH = "15rem"; // w-60 = 240px = 15rem

// ============================================================================
// Security Constants
// ============================================================================

/** Minimum length of value to show partial masking */
export const MASK_MIN_LENGTH = 8;

/** Patterns indicating sensitive environment variables */
export const SENSITIVE_KEY_PATTERNS = [
  "key",
  "token",
  "secret",
  "password",
  "credential",
  "api",
  "auth",
] as const;

// ============================================================================
// MCP Source Priority
// ============================================================================

/**
 * Priority order for MCP server sources.
 * Higher number = higher priority = wins conflicts.
 */
export const MCP_SOURCE_PRIORITY = {
  local_claude_json: 100, // ~/.claude.json projects.<path>.mcpServers (highest)
  project_mcp: 80, // <project>/.mcp.json
  user_claude_json: 60, // ~/.claude.json mcpServers
  user_mcp: 40, // ~/.claude/.mcp.json (legacy)
  user_settings: 20, // ~/.claude/settings.json mcpServers (legacy, lowest)
} as const;

// ============================================================================
// Scope Metadata
// ============================================================================

export const SCOPE_INFO = {
  user: {
    icon: "User",
    colorClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    pathPattern: "~/.claude/settings.json",
  },
  project: {
    icon: "FolderOpen",
    colorClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    pathPattern: "<project>/.claude/settings.json",
  },
  local: {
    icon: "FileCode",
    colorClass: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    pathPattern: "<project>/.claude/settings.local.json",
  },
  managed: {
    icon: "Shield",
    colorClass: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    pathPattern: "/Library/Application Support/ClaudeCode/managed-settings.json",
    readonly: true,
  },
} as const;

// ============================================================================
// Animation Durations
// ============================================================================

/** Standard transition duration for UI elements (ms) */
export const TRANSITION_DURATION = 150;

/** Debounce delay for search input (ms) */
export const SEARCH_DEBOUNCE_MS = 300;
