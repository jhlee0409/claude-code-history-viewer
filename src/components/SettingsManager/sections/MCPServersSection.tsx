/**
 * MCPServersSection Component
 *
 * Flat MCP server list - no collapsibles, no tooltips.
 * Just a clean list of all servers with inline edit/delete.
 */

import * as React from "react";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Server,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import type { MCPServerConfig, MCPSource, SettingsScope } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface MCPServersSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  readOnly: boolean;
}

interface UnifiedServer {
  name: string;
  config: MCPServerConfig;
  source: MCPSource;
  scope: SettingsScope;
}

type SaveLocation = "user" | "project" | "local";

// ============================================================================
// Source to Scope mapping
// ============================================================================

const sourceToScope: Record<MCPSource, SettingsScope> = {
  user_claude_json: "user",
  local_claude_json: "local",
  user_settings: "user",
  user_mcp: "user",
  project_mcp: "project",
};

const scopeToSource: Record<SaveLocation, MCPSource> = {
  user: "user_claude_json",
  project: "project_mcp",
  local: "local_claude_json",
};

// Scope badge colors
const scopeColors: Record<SettingsScope, string> = {
  user: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  project: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  local: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  managed: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

// ============================================================================
// Server Row Component (Inline)
// ============================================================================

interface ServerRowProps {
  server: UnifiedServer;
  onDelete: () => void;
  onEdit: (newConfig: MCPServerConfig) => void;
  readOnly: boolean;
}

const ServerRow: React.FC<ServerRowProps> = React.memo(({
  server,
  onDelete,
  onEdit,
  readOnly,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editCommand, setEditCommand] = useState(server.config.command);
  const [editArgs, setEditArgs] = useState(server.config.args?.join(" ") || "");

  const handleSave = () => {
    onEdit({
      ...server.config,
      command: editCommand,
      args: editArgs.trim() ? editArgs.split(/\s+/) : undefined,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditCommand(server.config.command);
    setEditArgs(server.config.args?.join(" ") || "");
    setIsEditing(false);
  };

  const scopeLabel: Record<SettingsScope, string> = {
    user: t("settingsManager.scope.user"),
    project: t("settingsManager.scope.project"),
    local: t("settingsManager.scope.local"),
    managed: t("settingsManager.scope.managed"),
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-muted/50 rounded-lg">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium w-28 truncate">{server.name}</span>
            <Badge variant="outline" className={`text-[10px] ${scopeColors[server.scope]}`}>
              {scopeLabel[server.scope]}
            </Badge>
          </div>
          <Input
            value={editCommand}
            onChange={(e) => setEditCommand(e.target.value)}
            placeholder="command"
            className="h-7 text-xs font-mono"
          />
          <Input
            value={editArgs}
            onChange={(e) => setEditArgs(e.target.value)}
            placeholder="arguments"
            className="h-7 text-xs font-mono"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSave}>
            <Check className="w-4 h-4 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCancel}>
            <X className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 px-3 hover:bg-muted/30 rounded-lg group transition-colors">
      <Server className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-sm font-medium w-28 truncate">{server.name}</span>
      <Badge variant="outline" className={`text-[10px] shrink-0 ${scopeColors[server.scope]}`}>
        {scopeLabel[server.scope]}
      </Badge>
      <code className="text-xs text-muted-foreground font-mono truncate flex-1">
        {server.config.command} {server.config.args?.join(" ")}
      </code>
      {!readOnly && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
});

ServerRow.displayName = "ServerRow";

// ============================================================================
// Main Component
// ============================================================================

export const MCPServersSection: React.FC<MCPServersSectionProps> = React.memo(({
  // isExpanded and onToggle are kept for API compatibility but not used
  readOnly,
}) => {
  const { t } = useTranslation();
  const { mcpServers, saveMCPServers, projectPath } = useSettingsManager();

  // Dialog states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saveLocation, setSaveLocation] = useState<SaveLocation>("user");

  // Add server form state
  const [newServerName, setNewServerName] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("npx");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerEnv, setNewServerEnv] = useState<Record<string, string>>({});

  // Combine all servers into unified list
  const allServers = useMemo((): UnifiedServer[] => {
    const servers: UnifiedServer[] = [];

    const addServers = (
      source: MCPSource,
      serverMap: Record<string, MCPServerConfig>
    ) => {
      Object.entries(serverMap).forEach(([name, config]) => {
        servers.push({
          name,
          config,
          source,
          scope: sourceToScope[source],
        });
      });
    };

    addServers("user_claude_json", mcpServers.userClaudeJson);
    addServers("local_claude_json", mcpServers.localClaudeJson);
    addServers("user_settings", mcpServers.userSettings);
    addServers("user_mcp", mcpServers.userMcpFile);
    addServers("project_mcp", mcpServers.projectMcpFile);

    return servers.sort((a, b) => a.name.localeCompare(b.name));
  }, [mcpServers]);

  // Get servers map for a specific source
  const getServersForSource = useCallback((source: MCPSource): Record<string, MCPServerConfig> => {
    switch (source) {
      case "user_claude_json": return mcpServers.userClaudeJson;
      case "local_claude_json": return mcpServers.localClaudeJson;
      case "user_settings": return mcpServers.userSettings;
      case "user_mcp": return mcpServers.userMcpFile;
      case "project_mcp": return mcpServers.projectMcpFile;
      default: return {};
    }
  }, [mcpServers]);

  // Handle add server
  const handleAddServer = async () => {
    if (!newServerName.trim() || !newServerCommand.trim()) return;

    const newServer: MCPServerConfig = {
      command: newServerCommand.trim(),
      args: newServerArgs.trim() ? newServerArgs.split(/\s+/) : undefined,
      env: Object.keys(newServerEnv).length > 0 ? newServerEnv : undefined,
    };

    const source = scopeToSource[saveLocation];
    const currentServers = getServersForSource(source);
    const updatedServers = {
      ...currentServers,
      [newServerName.trim()]: newServer,
    };

    await saveMCPServers(source, updatedServers, saveLocation === "project" ? projectPath : undefined);
    resetForm();
    setIsAddOpen(false);
  };

  // Handle delete server
  const handleDeleteServer = async (server: UnifiedServer) => {
    const currentServers = getServersForSource(server.source);
    const { [server.name]: _, ...rest } = currentServers;
    await saveMCPServers(
      server.source,
      rest,
      server.source === "project_mcp" ? projectPath : undefined
    );
  };

  // Handle edit server
  const handleEditServer = async (server: UnifiedServer, newConfig: MCPServerConfig) => {
    const currentServers = getServersForSource(server.source);
    const updatedServers = {
      ...currentServers,
      [server.name]: newConfig,
    };
    await saveMCPServers(
      server.source,
      updatedServers,
      server.source === "project_mcp" ? projectPath : undefined
    );
  };

  // Reset form
  const resetForm = () => {
    setNewServerName("");
    setNewServerCommand("npx");
    setNewServerArgs("");
    setNewServerEnv({});
    setSaveLocation("user");
  };

  return (
    <>
      {/* Section Header */}
      <div className="flex items-center justify-between py-2 px-1">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {t("settingsManager.unified.sections.mcp")}
          </span>
          <Badge variant="secondary" className="text-[10px] h-5">
            {allServers.length}
          </Badge>
        </div>
        {!readOnly && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setIsAddOpen(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t("settingsManager.mcp.add")}
          </Button>
        )}
      </div>

      {/* Server List - Always Visible */}
      <div className="border rounded-lg divide-y">
        {allServers.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
            {t("settingsManager.mcp.empty")}
          </div>
        ) : (
          allServers.map((server) => (
            <ServerRow
              key={`${server.source}-${server.name}`}
              server={server}
              onDelete={() => handleDeleteServer(server)}
              onEdit={(newConfig) => handleEditServer(server, newConfig)}
              readOnly={readOnly}
            />
          ))
        )}
      </div>

      {/* Add Server Dialog */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              {t("settingsManager.mcp.addTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settingsManager.mcp.addDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Server Form */}
            <div className="space-y-3">
              <div>
                <Label>{t("settingsManager.mcp.serverName")}</Label>
                <Input
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="my-mcp-server"
                  className="mt-1"
                />
              </div>

              <div>
                <Label>{t("settingsManager.mcp.command")}</Label>
                <Input
                  value={newServerCommand}
                  onChange={(e) => setNewServerCommand(e.target.value)}
                  placeholder="npx"
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <Label>{t("settingsManager.mcp.args")}</Label>
                <Input
                  value={newServerArgs}
                  onChange={(e) => setNewServerArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-name"
                  className="mt-1 font-mono text-sm"
                />
              </div>

                {/* Env vars */}
                {Object.keys(newServerEnv).length > 0 && (
                  <div className="space-y-2">
                    <Label>{t("settingsManager.mcp.envVars")}</Label>
                    {Object.keys(newServerEnv).map((key) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-40 truncate">
                          {key}
                        </span>
                        <Input
                          type="password"
                          value={newServerEnv[key]}
                          onChange={(e) =>
                            setNewServerEnv({ ...newServerEnv, [key]: e.target.value })
                          }
                          placeholder="Enter value..."
                          className="flex-1 font-mono text-sm"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Save Location */}
                <div>
                  <Label>{t("settingsManager.mcp.saveLocation")}</Label>
                  <Select value={saveLocation} onValueChange={(v) => setSaveLocation(v as SaveLocation)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500" />
                          {t("settingsManager.mcp.location.user")}
                        </span>
                      </SelectItem>
                      <SelectItem value="project" disabled={!projectPath}>
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          {t("settingsManager.mcp.location.project")}
                        </span>
                      </SelectItem>
                      <SelectItem value="local">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500" />
                          {t("settingsManager.mcp.location.local")}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {saveLocation === "user" && t("settingsManager.mcp.location.userDesc")}
                    {saveLocation === "project" && t("settingsManager.mcp.location.projectDesc")}
                    {saveLocation === "local" && t("settingsManager.mcp.location.localDesc")}
                  </p>
                </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsAddOpen(false); resetForm(); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleAddServer}
              disabled={!newServerName.trim() || !newServerCommand.trim()}
            >
              {t("settingsManager.mcp.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

MCPServersSection.displayName = "MCPServersSection";
