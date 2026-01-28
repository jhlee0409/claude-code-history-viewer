/**
 * MCP Servers Management Hook
 *
 * Manages MCP server configurations from all sources:
 *
 * Official sources (from ~/.claude.json):
 * - User claude.json: ~/.claude.json mcpServers (user-scoped, cross-project)
 * - Local claude.json: ~/.claude.json projects.<path>.mcpServers (local-scoped)
 *
 * Legacy sources:
 * - User settings.json: ~/.claude/settings.json mcpServers field
 * - User .mcp.json: ~/.claude/.mcp.json
 *
 * Project source:
 * - Project .mcp.json: <project>/.mcp.json
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
  isLoading: boolean;
  error: string | null;

  // Actions
  loadAllMCPServers: () => Promise<void>;
  saveMCPServers: (
    source: MCPSource,
    servers: Record<string, MCPServerConfig>,
    targetProjectPath?: string
  ) => Promise<void>;
}

/**
 * Hook for managing MCP servers from all sources
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

  // Load all MCP servers from all sources
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

  // Save MCP servers to a specific source (optionally to a different project)
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

  // Load MCP servers on mount and when projectPath changes
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
