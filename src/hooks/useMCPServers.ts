/**
 * MCP Servers Management Hook
 *
 * **MULTI-SOURCE MCP CONFIGURATION MANAGER**
 *
 * Manages MCP (Model Context Protocol) server configurations from all sources
 * in the Claude Code ecosystem. Provides a unified interface to read and write
 * MCP configs across official and legacy file locations.
 *
 * @example Load All Sources
 * ```typescript
 * const {
 *   userClaudeJson,    // Official: ~/.claude.json mcpServers
 *   localClaudeJson,   // Official: ~/.claude.json projects.<path>.mcpServers
 *   userSettings,      // Legacy: ~/.claude/settings.json mcpServers
 *   userMcpFile,       // Legacy: ~/.claude/.mcp.json
 *   projectMcpFile,    // Project: <project>/.mcp.json
 *   loadAllMCPServers,
 *   saveMCPServers
 * } = useMCPServers("/path/to/project");
 *
 * // All sources auto-load on mount
 * ```
 *
 * @example Save to Specific Source
 * ```typescript
 * await saveMCPServers("userClaudeJson", {
 *   "my-server": {
 *     command: "npx",
 *     args: ["-y", "my-mcp-server"],
 *     env: { API_KEY: "secret" }
 *   }
 * });
 * ```
 *
 * @example Cross-Project Save
 * ```typescript
 * // Save to a different project's .mcp.json
 * await saveMCPServers(
 *   "projectMcpFile",
 *   servers,
 *   "/different/project/path"
 * );
 * ```
 *
 * @remarks
 * **Source Priority (for Claude Code):**
 * 1. Official sources take precedence (userClaudeJson, localClaudeJson)
 * 2. Legacy sources for backward compatibility
 * 3. Project-specific configs override user-level
 *
 * **Data Consistency:**
 * - Auto-reloads from backend after save to prevent stale UI
 * - Backend is source of truth for all file operations
 *
 * **File Locations:**
 * - `~/.claude.json` - Official user-level and project-scoped configs
 * - `~/.claude/settings.json` - Legacy user settings
 * - `~/.claude/.mcp.json` - Legacy user MCP file
 * - `<project>/.mcp.json` - Project-specific MCP config
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MCPServerConfig, MCPSource, AllMCPServersResponse } from "../types";

export interface UseMCPServersResult {
  // Official sources (from ~/.claude.json)
  /** MCP servers from ~/.claude.json mcpServers (user-scoped, cross-project) */
  userClaudeJson: Record<string, MCPServerConfig>;
  /** MCP servers from ~/.claude.json projects.<path>.mcpServers (local-scoped) */
  localClaudeJson: Record<string, MCPServerConfig>;

  // Legacy sources
  /** MCP servers from ~/.claude/settings.json mcpServers field */
  userSettings: Record<string, MCPServerConfig>;
  /** MCP servers from ~/.claude/.mcp.json */
  userMcpFile: Record<string, MCPServerConfig>;

  // Project source
  /** MCP servers from <project>/.mcp.json */
  projectMcpFile: Record<string, MCPServerConfig>;

  // State
  /** Loading state for async operations */
  isLoading: boolean;
  /** Error message from last failed operation */
  error: string | null;

  // Actions
  /** Load MCP servers from all sources */
  loadAllMCPServers: () => Promise<void>;
  /**
   * Save MCP servers to a specific source
   * @param source - Target source location
   * @param servers - Server configurations to save
   * @param targetProjectPath - Optional different project path (for projectMcpFile source)
   */
  saveMCPServers: (
    source: MCPSource,
    servers: Record<string, MCPServerConfig>,
    targetProjectPath?: string
  ) => Promise<void>;
}

/**
 * Hook for managing MCP servers from all sources
 *
 * @param projectPath - Optional project path for loading project-specific MCP configs
 * @returns MCP server state from all sources and management functions
 */
export const useMCPServers = (projectPath?: string): UseMCPServersResult => {
  // Official sources (from ~/.claude.json)
  const [userClaudeJson, setUserClaudeJson] = useState<Record<string, MCPServerConfig>>({});
  const [localClaudeJson, setLocalClaudeJson] = useState<Record<string, MCPServerConfig>>({});

  // Legacy sources
  const [userSettings, setUserSettings] = useState<Record<string, MCPServerConfig>>({});
  const [userMcpFile, setUserMcpFile] = useState<Record<string, MCPServerConfig>>({});

  // Project source
  const [projectMcpFile, setProjectMcpFile] = useState<Record<string, MCPServerConfig>>({});

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load all MCP servers from all sources
   *
   * Fetches configs from official, legacy, and project sources in a single
   * backend call for efficiency.
   */
  const loadAllMCPServers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await invoke<AllMCPServersResponse>("get_all_mcp_servers", {
        projectPath,
      });

      // Official sources
      setUserClaudeJson(response.userClaudeJson ?? {});
      setLocalClaudeJson(response.localClaudeJson ?? {});

      // Legacy sources
      setUserSettings(response.userSettings ?? {});
      setUserMcpFile(response.userMcpFile ?? {});

      // Project source
      setProjectMcpFile(response.projectMcpFile ?? {});
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      console.error("Failed to load MCP servers:", err);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  /**
   * Save MCP servers to a specific source
   *
   * Writes to the specified source file and reloads all sources to ensure
   * UI consistency. Supports cross-project saves via targetProjectPath.
   *
   * @param source - Target source location (e.g., "userClaudeJson", "projectMcpFile")
   * @param servers - Server configurations (Record<serverName, MCPServerConfig>)
   * @param targetProjectPath - Override projectPath for cross-project saves
   */
  const saveMCPServers = useCallback(
    async (source: MCPSource, servers: Record<string, MCPServerConfig>, targetProjectPath?: string) => {
      setIsLoading(true);
      setError(null);

      const effectiveProjectPath = targetProjectPath ?? projectPath;

      try {
        await invoke("save_mcp_servers", {
          source,
          servers: JSON.stringify(servers),
          projectPath: effectiveProjectPath,
        });

        // Reload from backend after save to ensure consistency
        // This prevents race conditions where UI shows stale data if backend partially fails
        await loadAllMCPServers();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to save MCP servers:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [projectPath, loadAllMCPServers]
  );

  /**
   * Auto-load MCP servers on mount and when projectPath changes
   *
   * Ensures fresh data when switching projects or initializing.
   */
  useEffect(() => {
    loadAllMCPServers();
  }, [loadAllMCPServers]);

  return {
    // Official sources
    userClaudeJson,
    localClaudeJson,

    // Legacy sources
    userSettings,
    userMcpFile,

    // Project source
    projectMcpFile,

    // State
    isLoading,
    error,

    // Actions
    loadAllMCPServers,
    saveMCPServers,
  };
};
