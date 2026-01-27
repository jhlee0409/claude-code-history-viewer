/**
 * UnifiedMCPList Component
 *
 * Displays all MCP servers from all sources in a unified view.
 * Shows source attribution and allows quick navigation to edit specific servers.
 *
 * Sources (in priority order):
 * - local_claude_json: ~/.claude.json projects.<path>.mcpServers (official, project-specific)
 * - project_mcp: <project>/.mcp.json (shared via version control)
 * - user_claude_json: ~/.claude.json mcpServers (official, user-scoped)
 * - user_mcp: ~/.claude/.mcp.json (legacy)
 * - user_settings: ~/.claude/settings.json mcpServers (legacy)
 */

import * as React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  Server,
  AlertTriangle,
  ExternalLink,
  Terminal,
  Globe,
} from "lucide-react";
import type { MCPServerConfig, MCPSource } from "@/types";
import { maskIfSensitive } from "@/utils/securityUtils";

// ============================================================================
// Types
// ============================================================================

interface UnifiedMCPServer {
  name: string;
  config: MCPServerConfig;
  source: MCPSource;
  hasConflict: boolean;
  conflictingSources?: MCPSource[];
}

interface UnifiedMCPListProps {
  // Official sources (from ~/.claude.json)
  userClaudeJsonServers: Record<string, MCPServerConfig>;
  localClaudeJsonServers: Record<string, MCPServerConfig>;
  // Legacy sources
  userSettingsServers: Record<string, MCPServerConfig>;
  userMcpServers: Record<string, MCPServerConfig>;
  // Project source
  projectMcpServers: Record<string, MCPServerConfig>;
  onNavigateToSource?: (source: MCPSource, serverName?: string) => void;
}

// ============================================================================
// Source Badge Component
// ============================================================================

const sourceColors: Record<MCPSource, string> = {
  // Official sources (highlighted)
  user_claude_json: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  local_claude_json: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  // Project source
  project_mcp: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  // Legacy sources (muted)
  user_settings: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  user_mcp: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

interface SourceBadgeProps {
  source: MCPSource;
  onClick?: () => void;
  showLegacyBadge?: boolean;
}

const SourceBadge: React.FC<SourceBadgeProps> = React.memo(({ source, onClick, showLegacyBadge = false }) => {
  const { t } = useTranslation();

  const sourceLabels: Record<MCPSource, string> = {
    user_claude_json: t("settingsManager.mcp.sourceUserClaudeJson"),
    local_claude_json: t("settingsManager.mcp.sourceLocalClaudeJson"),
    project_mcp: t("settingsManager.mcp.sourceProjectMcp"),
    user_settings: t("settingsManager.mcp.sourceLegacySettings"),
    user_mcp: t("settingsManager.mcp.sourceLegacyMcp"),
  };

  const isLegacy = source === "user_settings" || source === "user_mcp";

  return (
    <Badge
      variant="outline"
      className={`${sourceColors[source]} cursor-pointer hover:opacity-80 text-xs`}
      onClick={onClick}
    >
      {sourceLabels[source]}
      {showLegacyBadge && isLegacy && (
        <span className="ml-1 opacity-80">({t("settingsManager.mcp.legacy")})</span>
      )}
    </Badge>
  );
});

SourceBadge.displayName = "SourceBadge";

// ============================================================================
// Server Card Component
// ============================================================================

interface ServerCardProps {
  server: UnifiedMCPServer;
  onNavigate?: () => void;
}

const ServerCard: React.FC<ServerCardProps> = React.memo(({ server, onNavigate }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);

  const isHttpServer = server.config.type === "http" || server.config.url;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={`border rounded-lg ${
          server.hasConflict
            ? "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20"
            : "border-border"
        }`}
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 text-muted-foreground hover:text-accent hover:bg-accent/10 rounded-t-lg transition-colors duration-150">
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            {isHttpServer ? (
              <Globe className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Server className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="font-medium text-sm">{server.name}</span>
            {server.hasConflict && (
              <Tooltip>
                <TooltipTrigger>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent>
                  {t("settingsManager.mcp.unified.conflict")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SourceBadge source={server.source} onClick={onNavigate} showLegacyBadge />
            {onNavigate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate();
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2 border-t">
            {/* Connection Type */}
            {isHttpServer ? (
              <div className="pt-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {t("settingsManager.mcp.url")}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                    {server.config.url}
                  </code>
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <span className="text-xs text-muted-foreground font-medium">
                  {t("settingsManager.mcp.command")}
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                    {server.config.command} {server.config.args?.join(" ")}
                  </code>
                </div>
              </div>
            )}

            {/* Environment Variables */}
            {server.config.env && Object.keys(server.config.env).length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground font-medium">
                  {t("settingsManager.mcp.envVars")}
                </span>
                <div className="mt-1 space-y-1">
                  {Object.entries(server.config.env).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                      <code className="font-mono text-muted-foreground">{key}:</code>
                      <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                        {maskIfSensitive(key, value)}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Conflicting Sources */}
            {server.hasConflict && server.conflictingSources && (
              <div className="pt-2 border-t">
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  {t("settingsManager.mcp.unified.alsoDefinedIn")}
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {server.conflictingSources.map((source) => (
                    <SourceBadge key={source} source={source} showLegacyBadge />
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});

ServerCard.displayName = "ServerCard";

// ============================================================================
// Main Component
// ============================================================================

export const UnifiedMCPList: React.FC<UnifiedMCPListProps> = React.memo(({
  userClaudeJsonServers,
  localClaudeJsonServers,
  userSettingsServers,
  userMcpServers,
  projectMcpServers,
  onNavigateToSource,
}) => {
  const { t } = useTranslation();

  // Merge all servers with conflict detection
  const unifiedServers = useMemo(() => {
    const serverMap = new Map<string, UnifiedMCPServer>();
    const sourceMap = new Map<string, MCPSource[]>();

    // Collect all sources for each server name
    const addSource = (
      servers: Record<string, MCPServerConfig>,
      source: MCPSource
    ) => {
      Object.keys(servers).forEach((name) => {
        const sources = sourceMap.get(name) || [];
        sources.push(source);
        sourceMap.set(name, sources);
      });
    };

    // Add all sources
    addSource(localClaudeJsonServers, "local_claude_json");
    addSource(projectMcpServers, "project_mcp");
    addSource(userClaudeJsonServers, "user_claude_json");
    addSource(userMcpServers, "user_mcp");
    addSource(userSettingsServers, "user_settings");

    // Priority order: local_claude_json > project_mcp > user_claude_json > user_mcp > user_settings
    const addServer = (
      servers: Record<string, MCPServerConfig>,
      source: MCPSource
    ) => {
      Object.entries(servers).forEach(([name, config]) => {
        if (!serverMap.has(name)) {
          const allSources = sourceMap.get(name) || [];
          const conflictingSources = allSources.filter((s) => s !== source);

          serverMap.set(name, {
            name,
            config,
            source,
            hasConflict: conflictingSources.length > 0,
            conflictingSources:
              conflictingSources.length > 0 ? conflictingSources : undefined,
          });
        }
      });
    };

    // Add in priority order (highest first)
    addServer(localClaudeJsonServers, "local_claude_json");
    addServer(projectMcpServers, "project_mcp");
    addServer(userClaudeJsonServers, "user_claude_json");
    addServer(userMcpServers, "user_mcp");
    addServer(userSettingsServers, "user_settings");

    return Array.from(serverMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [userClaudeJsonServers, localClaudeJsonServers, userSettingsServers, userMcpServers, projectMcpServers]);

  // Count by source
  const countBySource = useMemo(() => {
    return {
      user_claude_json: Object.keys(userClaudeJsonServers).length,
      local_claude_json: Object.keys(localClaudeJsonServers).length,
      project_mcp: Object.keys(projectMcpServers).length,
      user_settings: Object.keys(userSettingsServers).length,
      user_mcp: Object.keys(userMcpServers).length,
    };
  }, [userClaudeJsonServers, localClaudeJsonServers, userSettingsServers, userMcpServers, projectMcpServers]);

  const conflictCount = unifiedServers.filter((s) => s.hasConflict).length;
  const legacyCount = countBySource.user_settings + countBySource.user_mcp;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="w-5 h-5" />
            {t("settingsManager.mcp.unified.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            {conflictCount > 0 && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-xs text-amber-600">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {conflictCount}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settingsManager.mcp.unified.conflictCount", {
                    count: conflictCount,
                  })}
                </TooltipContent>
              </Tooltip>
            )}
            <Badge variant="secondary" className="text-xs">
              {unifiedServers.length} {t("settingsManager.mcp.unified.servers")}
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settingsManager.mcp.unified.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Source Summary */}
        <div className="flex flex-wrap gap-3 pb-2 border-b">
          {/* Official sources first */}
          {countBySource.user_claude_json > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <SourceBadge
                source="user_claude_json"
                onClick={() => onNavigateToSource?.("user_claude_json")}
              />
              <span className="text-muted-foreground">
                ({countBySource.user_claude_json})
              </span>
            </div>
          )}
          {countBySource.local_claude_json > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <SourceBadge
                source="local_claude_json"
                onClick={() => onNavigateToSource?.("local_claude_json")}
              />
              <span className="text-muted-foreground">
                ({countBySource.local_claude_json})
              </span>
            </div>
          )}
          {countBySource.project_mcp > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <SourceBadge
                source="project_mcp"
                onClick={() => onNavigateToSource?.("project_mcp")}
              />
              <span className="text-muted-foreground">
                ({countBySource.project_mcp})
              </span>
            </div>
          )}
          {/* Legacy sources with separator */}
          {legacyCount > 0 && (
            <>
              <span className="text-muted-foreground/50">|</span>
              {countBySource.user_settings > 0 && (
                <div className="flex items-center gap-1.5 text-xs opacity-80">
                  <SourceBadge
                    source="user_settings"
                    onClick={() => onNavigateToSource?.("user_settings")}
                  />
                  <span className="text-muted-foreground">
                    ({countBySource.user_settings})
                  </span>
                </div>
              )}
              {countBySource.user_mcp > 0 && (
                <div className="flex items-center gap-1.5 text-xs opacity-80">
                  <SourceBadge
                    source="user_mcp"
                    onClick={() => onNavigateToSource?.("user_mcp")}
                  />
                  <span className="text-muted-foreground">
                    ({countBySource.user_mcp})
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Server List */}
        {unifiedServers.length > 0 ? (
          <div className="space-y-2">
            {unifiedServers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                onNavigate={() =>
                  onNavigateToSource?.(server.source, server.name)
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("settingsManager.mcp.empty")}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

UnifiedMCPList.displayName = "UnifiedMCPList";
