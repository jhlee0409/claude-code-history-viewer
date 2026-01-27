/**
 * MCP Server Preset Types
 *
 * Type definitions for MCP server configuration presets.
 */

import type { MCPServerConfig } from "./claudeSettings";

/**
 * MCP server preset data structure
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
 * Input for creating/updating an MCP preset
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

/**
 * Parse MCP servers from preset JSON string
 */
export function parseMCPServers(serversJson: string): Record<string, MCPServerConfig> {
  try {
    return JSON.parse(serversJson) as Record<string, MCPServerConfig>;
  } catch {
    return {};
  }
}

/**
 * Format date for MCP preset display
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
