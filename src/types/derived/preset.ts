/**
 * Unified Preset Types
 *
 * Consolidated preset type definitions for configuration management.
 * Combines settings presets, MCP presets, and unified presets into one coherent system.
 *
 * Location: ~/.claude-history-viewer/unified-presets/
 */

import type {
  ClaudeCodeSettings,
  ClaudeModel,
  MCPServerConfig,
  SettingsScope,
} from "../core/settings";
import type { UserSettings } from "../core/project";

// ============================================================================
// Legacy User Settings Preset (Deprecated)
// ============================================================================

/**
 * @deprecated Use UnifiedPresetData instead
 * Legacy data structure for settings presets
 */
export interface PresetData {
  /** Unique identifier for the preset */
  id: string;
  /** Display name for the preset */
  name: string;
  /** Optional description of the preset */
  description?: string;
  /** JSON string of UserSettings */
  settings: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/**
 * @deprecated Use UnifiedPresetInput instead
 * Legacy input structure for creating/updating presets
 */
export interface PresetInput {
  /** Optional ID (auto-generated if not provided) */
  id?: string;
  /** Display name for the preset */
  name: string;
  /** Optional description of the preset */
  description?: string;
  /** JSON string of UserSettings */
  settings: string;
}

/** Helper to convert UserSettings to JSON string */
export const settingsToJson = (settings: UserSettings): string => {
  return JSON.stringify(settings);
};

/** Helper to parse settings JSON string */
export const jsonToSettings = (json: string): UserSettings => {
  return JSON.parse(json) as UserSettings;
};

/** Helper to create preset input from UserSettings */
export const createPresetInput = (
  name: string,
  settings: UserSettings,
  description?: string,
  id?: string
): PresetInput => {
  return {
    id,
    name,
    description,
    settings: settingsToJson(settings),
  };
};

/** Helper to extract settings from preset data */
export const extractSettings = (preset: PresetData): UserSettings => {
  return jsonToSettings(preset.settings);
};

// ============================================================================
// Legacy MCP Preset (Deprecated)
// ============================================================================

/**
 * @deprecated Use UnifiedPresetData instead
 * Legacy MCP server preset data structure
 */
export interface MCPPresetData {
  /** Unique preset identifier */
  id: string;
  /** Human-readable preset name */
  name: string;
  /** Optional description */
  description?: string;
  /** MCP server configurations (JSON string) */
  servers: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt?: string;
}

/**
 * @deprecated Use UnifiedPresetInput instead
 * Legacy input for creating/updating an MCP preset
 */
export interface MCPPresetInput {
  /** Optional ID for updates (auto-generated if not provided) */
  id?: string;
  /** Preset name */
  name: string;
  /** Optional description */
  description?: string;
  /** MCP server configurations (JSON string) */
  servers: string;
}

/** Parse MCP servers from preset JSON string */
export function parseMCPServers(serversJson: string): Record<string, MCPServerConfig> {
  try {
    return JSON.parse(serversJson) as Record<string, MCPServerConfig>;
  } catch {
    return {};
  }
}

// ============================================================================
// Unified Preset (Current)
// ============================================================================

/**
 * Unified preset data structure
 * Combines both settings and MCP servers into a single preset
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

/**
 * Format preset timestamp for display (with time)
 */
export function formatMCPPresetDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * @deprecated Use formatPresetDate or formatMCPPresetDate
 */
export const formatUnifiedPresetDate = formatPresetDate;
