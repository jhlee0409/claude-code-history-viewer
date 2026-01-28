/**
 * Unified Configuration Preset Types
 *
 * Single preset type that captures complete config state:
 * - Settings from settings.json
 * - MCP servers from claude.json
 *
 * When applied, intelligently routes data to correct files.
 */

import type {
  ClaudeCodeSettings,
  ClaudeModel,
  MCPServerConfig,
  SettingsScope,
} from "./claudeSettings";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Unified preset data structure
 * Stored in ~/.claude-history-viewer/unified-presets/*.json
 */
export interface UnifiedPresetData {
  /** Unique identifier (UUID) */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;

  // === Content (JSON strings for flexibility) ===

  /** Settings content (ClaudeCodeSettings as JSON) */
  settings: string;
  /** MCP servers (Record<string, MCPServerConfig> as JSON) */
  mcpServers: string;

  // === Metadata for UI display ===

  /** Summary computed from content */
  summary: UnifiedPresetSummary;
}

/**
 * Summary metadata for preset card display
 */
export interface UnifiedPresetSummary {
  /** Number of non-empty settings fields */
  settingsCount: number;
  /** Model name if specified */
  model?: ClaudeModel;
  /** Number of MCP servers */
  mcpServerCount: number;
  /** First few MCP server names for preview */
  mcpServerNames: string[];
  /** Has permissions configured */
  hasPermissions: boolean;
  /** Has hooks configured */
  hasHooks: boolean;
  /** Has environment variables */
  hasEnvVars: boolean;
}

// ============================================================================
// Input/Output Types
// ============================================================================

/**
 * Input for creating or updating a unified preset
 */
export interface UnifiedPresetInput {
  /** Existing ID for update, omit for create */
  id?: string;
  /** Preset name */
  name: string;
  /** Optional description */
  description?: string;
  /** Settings JSON string */
  settings: string;
  /** MCP servers JSON string */
  mcpServers: string;
}

/**
 * Options when applying a unified preset
 */
export interface UnifiedPresetApplyOptions {
  /** Target scope for settings.json */
  settingsScope: Exclude<SettingsScope, "managed">;
  /** Project path (required for project/local scope) */
  projectPath?: string;
  /** Whether to apply MCP servers (default: true) */
  applyMcpServers: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute summary from preset content
 */
export function computePresetSummary(
  settings: ClaudeCodeSettings,
  mcpServers: Record<string, MCPServerConfig>
): UnifiedPresetSummary {
  const serverNames = Object.keys(mcpServers);

  // Count non-empty settings
  let settingsCount = 0;
  if (settings.model) settingsCount++;
  if (settings.language) settingsCount++;
  if (settings.permissions?.allow?.length || settings.permissions?.deny?.length) settingsCount++;
  if (settings.hooks && Object.keys(settings.hooks).length > 0) settingsCount++;
  if (settings.env && Object.keys(settings.env).length > 0) settingsCount++;
  if (settings.alwaysThinkingEnabled) settingsCount++;
  if (settings.autoUpdatesChannel) settingsCount++;
  if (settings.attribution?.commit || settings.attribution?.pr) settingsCount++;

  return {
    settingsCount,
    model: settings.model,
    mcpServerCount: serverNames.length,
    mcpServerNames: serverNames.slice(0, 5),
    hasPermissions: !!(
      settings.permissions?.allow?.length ||
      settings.permissions?.deny?.length ||
      settings.permissions?.ask?.length
    ),
    hasHooks: !!(settings.hooks && Object.keys(settings.hooks).length > 0),
    hasEnvVars: !!(settings.env && Object.keys(settings.env).length > 0),
  };
}

/**
 * Parse preset content safely
 */
export function parsePresetContent(preset: UnifiedPresetData): {
  settings: ClaudeCodeSettings;
  mcpServers: Record<string, MCPServerConfig>;
} {
  try {
    const settings = JSON.parse(preset.settings) as ClaudeCodeSettings;
    const mcpServers = JSON.parse(preset.mcpServers) as Record<string, MCPServerConfig>;
    return { settings, mcpServers };
  } catch {
    return { settings: {}, mcpServers: {} };
  }
}

/**
 * Format preset date for display
 */
export function formatPresetDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
