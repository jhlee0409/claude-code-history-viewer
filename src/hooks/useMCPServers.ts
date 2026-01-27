/**
 * MCP Servers Management Hook
 *
 * Manages MCP server configurations from all sources:
 * - User settings.json (mcpServers field)
 * - User .mcp.json file
 * - Project .mcp.json file
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MCPServerConfig, MCPSource, AllMCPServersResponse } from "../types";

export interface UseMCPServersResult {
  // State
  userSettings: Record<string, MCPServerConfig>;
  userMcpFile: Record<string, MCPServerConfig>;
  projectMcpFile: Record<string, MCPServerConfig>;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadAllMCPServers: () => Promise<void>;
  saveMCPServers: (
    source: MCPSource,
    servers: Record<string, MCPServerConfig>
  ) => Promise<void>;
}

/**
 * Hook for managing MCP servers from all sources
 */
export const useMCPServers = (projectPath?: string): UseMCPServersResult => {
  const [userSettings, setUserSettings] = useState<Record<string, MCPServerConfig>>({});
  const [userMcpFile, setUserMcpFile] = useState<Record<string, MCPServerConfig>>({});
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

      setUserSettings(response.userSettings ?? {});
      setUserMcpFile(response.userMcpFile ?? {});
      setProjectMcpFile(response.projectMcpFile ?? {});
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      console.error("Failed to load MCP servers:", err);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  // Save MCP servers to a specific source
  const saveMCPServers = useCallback(
    async (source: MCPSource, servers: Record<string, MCPServerConfig>) => {
      setIsLoading(true);
      setError(null);

      try {
        await invoke("save_mcp_servers", {
          source,
          servers: JSON.stringify(servers),
          projectPath,
        });

        // Update local state
        switch (source) {
          case "user_settings":
            setUserSettings(servers);
            break;
          case "user_mcp":
            setUserMcpFile(servers);
            break;
          case "project_mcp":
            setProjectMcpFile(servers);
            break;
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        console.error("Failed to save MCP servers:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [projectPath]
  );

  // Load MCP servers on mount and when projectPath changes
  useEffect(() => {
    loadAllMCPServers();
  }, [loadAllMCPServers]);

  return {
    // State
    userSettings,
    userMcpFile,
    projectMcpFile,
    isLoading,
    error,

    // Actions
    loadAllMCPServers,
    saveMCPServers,
  };
};
