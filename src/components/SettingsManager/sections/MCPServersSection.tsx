/**
 * MCPServersSection Component
 *
 * Accordion section for MCP servers.
 * Shows servers for the current scope with add/remove functionality.
 * Also provides "View All Sources" button for unified view.
 */

import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
} from "@/components/ui/dialog";
import {
  ChevronDown,
  ChevronRight,
  Server,
  Plus,
  Layers,
  Trash2,
} from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { UnifiedMCPDialog } from "../dialogs/UnifiedMCPDialog";
import type { MCPServerConfig, MCPSource } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface MCPServersSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  readOnly: boolean;
}

// ============================================================================
// Server Card Sub-component
// ============================================================================

interface ServerCardProps {
  name: string;
  config: MCPServerConfig;
  onDelete: () => void;
  readOnly: boolean;
}

const ServerCard: React.FC<ServerCardProps> = React.memo(({
  name,
  config,
  onDelete,
  readOnly,
}) => {
  const { t } = useTranslation();
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);

  const maskValue = (value: string): string => {
    if (value.length <= 8) return String.fromCharCode(8226).repeat(8);
    return value.slice(0, 4) + String.fromCharCode(8226).repeat(4) + value.slice(-4);
  };

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-start justify-between">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{name}</span>
            {config.type && (
              <Badge variant="outline" className="text-xs">
                {config.type}
              </Badge>
            )}
          </div>
          <code className="text-xs text-muted-foreground font-mono block truncate">
            {config.command} {config.args?.join(" ")}
          </code>
          {config.env && Object.keys(config.env).length > 0 && (
            <div className="text-xs text-muted-foreground">
              {Object.keys(config.env).length} env vars:{" "}
              {Object.entries(config.env)
                .slice(0, 2)
                .map(([key, value]) => (
                  <span key={key} className="font-mono">
                    {key}={maskValue(value)}
                    {Object.keys(config.env || {}).length > 2 ? ", ..." : ""}
                  </span>
                ))}
            </div>
          )}
        </div>
        {!readOnly && (
          <div className="ml-2">
            {isDeleteConfirm ? (
              <div className="flex gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onDelete();
                    setIsDeleteConfirm(false);
                  }}
                >
                  {t("common.delete")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setIsDeleteConfirm(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setIsDeleteConfirm(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

ServerCard.displayName = "ServerCard";

// ============================================================================
// Main Component
// ============================================================================

export const MCPServersSection: React.FC<MCPServersSectionProps> = React.memo(({
  isExpanded,
  onToggle,
  readOnly,
}) => {
  const { t } = useTranslation();
  const { activeScope, mcpServers, saveMCPServers } = useSettingsManager();

  // Dialog states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isUnifiedOpen, setIsUnifiedOpen] = useState(false);

  // Add server form state
  const [newServerName, setNewServerName] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("npx");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerEnv, setNewServerEnv] = useState<Array<{ key: string; value: string }>>([]);

  // Get current MCP source based on active scope
  const getMCPSource = (): MCPSource => {
    switch (activeScope) {
      case "user":
        return "user_claude_json";
      case "project":
        return "project_mcp";
      case "local":
        return "local_claude_json";
      default:
        return "user_claude_json";
    }
  };

  // Get servers for current scope
  const currentServers = useMemo(() => {
    switch (activeScope) {
      case "user":
        return mcpServers.userClaudeJson;
      case "project":
        return mcpServers.projectMcpFile;
      case "local":
        return mcpServers.localClaudeJson;
      default:
        return {};
    }
  }, [activeScope, mcpServers]);

  const serverEntries = Object.entries(currentServers);
  const serverCount = serverEntries.length;

  // Total servers across all sources
  const totalServerCount = useMemo(() => {
    return (
      Object.keys(mcpServers.userClaudeJson).length +
      Object.keys(mcpServers.localClaudeJson).length +
      Object.keys(mcpServers.userSettings).length +
      Object.keys(mcpServers.userMcpFile).length +
      Object.keys(mcpServers.projectMcpFile).length
    );
  }, [mcpServers]);

  // Handle add server
  const handleAddServer = async () => {
    if (!newServerName.trim() || !newServerCommand.trim()) return;

    const newServer: MCPServerConfig = {
      command: newServerCommand.trim(),
      args: newServerArgs.trim() ? newServerArgs.split(/\s+/) : undefined,
      env:
        newServerEnv.length > 0
          ? Object.fromEntries(
              newServerEnv.filter((e) => e.key).map((e) => [e.key, e.value])
            )
          : undefined,
    };

    const updatedServers = {
      ...currentServers,
      [newServerName.trim()]: newServer,
    };

    await saveMCPServers(getMCPSource(), updatedServers);

    // Reset form
    setNewServerName("");
    setNewServerCommand("npx");
    setNewServerArgs("");
    setNewServerEnv([]);
    setIsAddOpen(false);
  };

  // Handle delete server
  const handleDeleteServer = async (name: string) => {
    const { [name]: _, ...rest } = currentServers;
    await saveMCPServers(getMCPSource(), rest);
  };

  // Env var helpers
  const addEnvVar = () => {
    setNewServerEnv([...newServerEnv, { key: "", value: "" }]);
  };

  const updateEnvVar = (index: number, field: "key" | "value", value: string) => {
    const updated = [...newServerEnv];
    const item = updated[index];
    if (item) {
      item[field] = value;
      setNewServerEnv(updated);
    }
  };

  const removeEnvVar = (index: number) => {
    setNewServerEnv(newServerEnv.filter((_, i) => i !== index));
  };

  return (
    <>
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-3 px-4 rounded-lg text-muted-foreground hover:text-accent hover:bg-accent/10 border border-border/40 transition-colors duration-150">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <Server className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">
              {t("settingsManager.unified.sections.mcp")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {serverCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {serverCount}
              </Badge>
            )}
            {totalServerCount > serverCount && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {totalServerCount} total
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pl-10 pr-4 pb-4 pt-2 space-y-3">
            {/* Action bar */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("settingsManager.mcp.serverCount", { count: serverCount })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setIsUnifiedOpen(true)}
                >
                  <Layers className="w-3.5 h-3.5 mr-1" />
                  {t("settingsManager.unified.mcp.viewAllSources")}
                </Button>
                {!readOnly && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setIsAddOpen(true)}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t("settingsManager.mcp.add")}
                  </Button>
                )}
              </div>
            </div>

            {/* Server list */}
            {serverCount === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground border rounded-lg">
                {t("settingsManager.mcp.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {serverEntries.map(([name, config]) => (
                  <ServerCard
                    key={name}
                    name={name}
                    config={config}
                    onDelete={() => handleDeleteServer(name)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Add Server Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.mcp.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t("settingsManager.mcp.args")}</Label>
              <Input
                value={newServerArgs}
                onChange={(e) => setNewServerArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-name"
                className="mt-1"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>{t("settingsManager.mcp.envVars")}</Label>
                <Button variant="outline" size="sm" onClick={addEnvVar}>
                  <Plus className="w-3 h-3 mr-1" />
                  Add
                </Button>
              </div>
              {newServerEnv.map((env, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <Input
                    placeholder="KEY"
                    value={env.key}
                    onChange={(e) => updateEnvVar(index, "key", e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="value"
                    value={env.value}
                    onChange={(e) => updateEnvVar(index, "value", e.target.value)}
                    type="password"
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEnvVar(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleAddServer} disabled={!newServerName.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unified MCP Dialog */}
      <UnifiedMCPDialog
        open={isUnifiedOpen}
        onOpenChange={setIsUnifiedOpen}
      />
    </>
  );
});

MCPServersSection.displayName = "MCPServersSection";
