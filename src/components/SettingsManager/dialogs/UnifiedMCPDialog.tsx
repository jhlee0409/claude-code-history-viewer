/**
 * UnifiedMCPDialog Component
 *
 * Dialog showing all MCP servers from all sources with conflict detection.
 * Allows navigating to specific sources to edit servers.
 */

import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, ExternalLink, Server } from "lucide-react";
import { maskValue } from "@/utils/securityUtils";
import { useSettingsManager } from "../UnifiedSettingsManager";
import type { MCPServerConfig, MCPSource, SettingsScope } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface UnifiedMCPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UnifiedServer {
  name: string;
  config: MCPServerConfig;
  source: MCPSource;
  sourceLabel: string;
}

// ============================================================================
// Source mapping
// ============================================================================

const sourceToScope: Record<MCPSource, SettingsScope> = {
  user_claude_json: "user",
  local_claude_json: "local",
  user_settings: "user",
  user_mcp: "user",
  project_mcp: "project",
};

const sourceLabels: Record<MCPSource, string> = {
  user_claude_json: "User (~/.claude.json)",
  local_claude_json: "Local (project)",
  user_settings: "Settings (legacy)",
  user_mcp: ".mcp.json (legacy)",
  project_mcp: "Project .mcp.json",
};

const sourceColors: Record<MCPSource, string> = {
  user_claude_json: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  local_claude_json: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  user_settings: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  user_mcp: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  project_mcp: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

// ============================================================================
// Component
// ============================================================================

export const UnifiedMCPDialog: React.FC<UnifiedMCPDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const { mcpServers, setActiveScope } = useSettingsManager();

  // Collect all servers from all sources
  const allServers = useMemo(() => {
    const servers: UnifiedServer[] = [];

    // Helper to add servers from a source
    const addServersFromSource = (
      sourceServers: Record<string, MCPServerConfig>,
      source: MCPSource
    ) => {
      Object.entries(sourceServers).forEach(([name, config]) => {
        servers.push({
          name,
          config,
          source,
          sourceLabel: sourceLabels[source],
        });
      });
    };

    addServersFromSource(mcpServers.userClaudeJson, "user_claude_json");
    addServersFromSource(mcpServers.localClaudeJson, "local_claude_json");
    addServersFromSource(mcpServers.userSettings, "user_settings");
    addServersFromSource(mcpServers.userMcpFile, "user_mcp");
    addServersFromSource(mcpServers.projectMcpFile, "project_mcp");

    return servers;
  }, [mcpServers]);

  // Find conflicting servers (same name, different sources)
  const conflicts = useMemo(() => {
    const serversByName = new Map<string, UnifiedServer[]>();

    allServers.forEach((server) => {
      const existing = serversByName.get(server.name) ?? [];
      existing.push(server);
      serversByName.set(server.name, existing);
    });

    return new Map(
      Array.from(serversByName.entries()).filter(([, servers]) => servers.length > 1)
    );
  }, [allServers]);

  // Group servers by name for display
  const serverGroups = useMemo(() => {
    const groups = new Map<string, UnifiedServer[]>();

    allServers.forEach((server) => {
      const existing = groups.get(server.name) ?? [];
      existing.push(server);
      groups.set(server.name, existing);
    });

    // Sort by name
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [allServers]);

  // Handle navigate to source
  const handleNavigateToSource = (source: MCPSource) => {
    const scope = sourceToScope[source];
    setActiveScope(scope);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            {t("settingsManager.unified.mcp.allServers")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {t("settingsManager.mcp.serverCount", { count: allServers.length })}
            </span>
            {conflicts.size > 0 && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {conflicts.size} {t("settingsManager.overview.conflicts")}
              </Badge>
            )}
          </div>

          {/* Empty state */}
          {serverGroups.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {t("settingsManager.mcp.empty")}
            </div>
          )}

          {/* Server list */}
          <div className="space-y-3">
            {serverGroups.map(([name, servers]) => {
              const hasConflict = servers.length > 1;
              const singleServer = servers.length === 1 ? servers[0] : null;

              return (
                <div
                  key={name}
                  className={`border rounded-lg p-3 ${
                    hasConflict ? "border-amber-300 dark:border-amber-700" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {hasConflict && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                              aria-label={t("settingsManager.unified.mcp.conflictHint")}
                            >
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("settingsManager.unified.mcp.conflictHint")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <span className="font-medium">{name}</span>
                    </div>
                    {singleServer && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => handleNavigateToSource(singleServer.source)}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        {t("settingsManager.unified.mcp.goToSource")}
                      </Button>
                    )}
                  </div>

                  {/* Server entries */}
                  <div className="space-y-2">
                    {servers.map((server, idx) => (
                      <div
                        key={`${server.source}-${idx}`}
                        className={`text-sm ${hasConflict ? "p-2 bg-muted rounded" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <code className="text-xs text-muted-foreground font-mono truncate flex-1">
                            {server.config.command} {server.config.args?.join(" ")}
                          </code>
                          <div className="flex items-center gap-2 ml-2">
                            <Badge
                              variant="outline"
                              className={`text-xs ${sourceColors[server.source]}`}
                            >
                              {server.sourceLabel}
                            </Badge>
                            {hasConflict && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-xs px-1"
                                onClick={() => handleNavigateToSource(server.source)}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                        {server.config.env && Object.keys(server.config.env).length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            env: {Object.entries(server.config.env).slice(0, 2).map(([key, value]) => (
                              <span key={key} className="font-mono mr-2">
                                {key}={maskValue(value)}
                              </span>
                            ))}
                            {Object.keys(server.config.env).length > 2 && "..."}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
