import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { MCPServerConfig, MCPPresetData } from "@/types";
import { formatMCPPresetDate, parseMCPServers } from "@/types";
import { useMCPPresets } from "@/hooks/useMCPPresets";
import { maskValue } from "@/utils/securityUtils";
import { Save, FolderOpen, Eye, Calendar, Hash, Server } from "lucide-react";

interface MCPServerManagerProps {
  servers: Record<string, MCPServerConfig>;
  onUpdate: (servers: Record<string, MCPServerConfig>) => void;
  readOnly?: boolean;
}

export const MCPServerManager: React.FC<MCPServerManagerProps> = React.memo(({
  servers,
  onUpdate,
  readOnly = false,
}) => {
  const { t } = useTranslation();
  const { presets, savePreset, deletePreset, isLoading: presetsLoading } = useMCPPresets();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // MCP Preset states
  const [isSavePresetOpen, setIsSavePresetOpen] = useState(false);
  const [isLoadPresetConfirmOpen, setIsLoadPresetConfirmOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<MCPPresetData | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetDeleteConfirmId, setPresetDeleteConfirmId] = useState<string | null>(null);

  // New server form state
  const [newServerName, setNewServerName] = useState("");
  const [newServerCommand, setNewServerCommand] = useState("npx");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerEnv, setNewServerEnv] = useState<Array<{ key: string; value: string }>>([]);

  const serverEntries = Object.entries(servers);
  const isServersEmpty = serverEntries.length === 0;

  const handleAddServer = () => {
    if (!newServerName.trim() || !newServerCommand.trim()) return;

    const newServer: MCPServerConfig = {
      command: newServerCommand.trim(),
      args: newServerArgs.trim() ? newServerArgs.split(/\s+/) : undefined,
      env:
        newServerEnv.length > 0
          ? Object.fromEntries(newServerEnv.filter((e) => e.key).map((e) => [e.key, e.value]))
          : undefined,
    };

    onUpdate({
      ...servers,
      [newServerName.trim()]: newServer,
    });

    // Reset form
    setNewServerName("");
    setNewServerCommand("npx");
    setNewServerArgs("");
    setNewServerEnv([]);
    setIsAddOpen(false);
  };

  const handleRemoveServer = (name: string) => {
    const { [name]: _, ...rest } = servers;
    onUpdate(rest);
    setDeleteConfirmId(null);
  };

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

  // MCP Preset handlers
  const pendingPreset = useMemo(
    () => presets.find((p) => p.id === pendingPresetId) ?? null,
    [presets, pendingPresetId]
  );

  const handlePresetSelect = (presetId: string) => {
    setPendingPresetId(presetId);
    setIsLoadPresetConfirmOpen(true);
  };

  const handleConfirmLoadPreset = () => {
    if (!pendingPreset) return;

    try {
      const loadedServers = parseMCPServers(pendingPreset.servers);
      onUpdate(loadedServers);
    } catch (e) {
      console.error("Failed to parse MCP preset servers:", e);
    } finally {
      setIsLoadPresetConfirmOpen(false);
      setPendingPresetId(null);
    }
  };

  const handleSaveAsPreset = async () => {
    if (!newPresetName.trim()) return;

    await savePreset({
      name: newPresetName.trim(),
      servers: JSON.stringify(servers, null, 2),
    });

    setNewPresetName("");
    setIsSavePresetOpen(false);
  };

  const openDetailDialog = (preset: MCPPresetData) => {
    setSelectedPreset(preset);
    setIsDetailOpen(true);
  };

  const handleDeletePreset = async (id: string) => {
    await deletePreset(id);
    setPresetDeleteConfirmId(null);
  };

  const getPresetSummary = (preset: MCPPresetData) => {
    try {
      const parsedServers = parseMCPServers(preset.servers);
      const serverCount = Object.keys(parsedServers).length;
      const serverNames = Object.keys(parsedServers).slice(0, 3);
      return { serverCount, serverNames, servers: parsedServers };
    } catch {
      return { serverCount: 0, serverNames: [], servers: {} };
    }
  };

  return (
    <div className="space-y-4">
      {/* Header with Actions */}
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("settingsManager.mcp.serverCount", { count: serverEntries.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Load Preset Dropdown */}
          {presets.length > 0 && !readOnly && (
            <Select onValueChange={handlePresetSelect}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                <SelectValue placeholder={t("settingsManager.mcp.loadPreset")} />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Save as Preset Button */}
          {!readOnly && !isServersEmpty && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSavePresetOpen(true)}
              className="h-8"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {t("settingsManager.mcp.saveAsPreset")}
            </Button>
          )}

          {/* Add Server Button */}
          {!readOnly && (
            <Button size="sm" onClick={() => setIsAddOpen(true)} className="h-8">
              {t("settingsManager.mcp.add")}
            </Button>
          )}
        </div>
      </div>

      {/* Server List */}
      {isServersEmpty ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t("settingsManager.mcp.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {serverEntries.map(([name, config]) => (
            <Card key={name}>
              <Collapsible
                open={expandedServer === name}
                onOpenChange={(open) => setExpandedServer(open ? name : null)}
              >
                <CollapsibleTrigger asChild>
                  <CardHeader className="py-3 cursor-pointer text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{name}</CardTitle>
                        <Badge variant="outline">{config.command}</Badge>
                        {config.type && <Badge>{config.type}</Badge>}
                      </div>
                      <div className="flex gap-2">
                        {!readOnly &&
                          (deleteConfirmId === name ? (
                            <>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveServer(name);
                                }}
                              >
                                {t("common.delete")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(null);
                                }}
                              >
                                {t("common.cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(name);
                              }}
                            >
                              {t("common.delete")}
                            </Button>
                          ))}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Command</Label>
                      <code className="block bg-muted px-2 py-1 rounded text-sm">
                        {config.command} {config.args?.join(" ")}
                      </code>
                    </div>
                    {config.description && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Description</Label>
                        <p className="text-sm">{config.description}</p>
                      </div>
                    )}
                    {config.env && Object.keys(config.env).length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Environment</Label>
                        <div className="space-y-1">
                          {Object.entries(config.env).map(([key, value]) => (
                            <div key={key} className="flex gap-2 text-sm">
                              <code className="bg-muted px-1 rounded">{key}</code>
                              <span>=</span>
                              <code className="bg-muted px-1 rounded">{maskValue(value)}</code>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {config.url && (
                      <div>
                        <Label className="text-xs text-muted-foreground">URL</Label>
                        <code className="block bg-muted px-2 py-1 rounded text-sm">
                          {config.url}
                        </code>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}

      {/* MCP Presets Section */}
      {presets.length > 0 && (
        <div className="mt-6 pt-4 border-t">
          <h4 className="text-sm font-medium mb-3">{t("settingsManager.mcp.presets")}</h4>
          <div className="space-y-2">
            {presets.map((preset) => {
              const summary = getPresetSummary(preset);
              return (
                <Card key={preset.id} variant="interactive">
                  <CardHeader className="py-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-sm">{preset.name}</CardTitle>
                        {preset.description && (
                          <CardDescription className="text-xs">{preset.description}</CardDescription>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{t("settingsManager.mcp.serverCount", { count: summary.serverCount })}</span>
                          <span>•</span>
                          <span>{formatMCPPresetDate(preset.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDetailDialog(preset)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          {t("settingsManager.presets.viewDetail")}
                        </Button>
                        {!readOnly && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePresetSelect(preset.id)}
                            >
                              {t("settingsManager.presets.apply")}
                            </Button>
                            {presetDeleteConfirmId === preset.id ? (
                              <>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDeletePreset(preset.id)}
                                >
                                  {t("common.delete")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPresetDeleteConfirmId(null)}
                                >
                                  {t("common.cancel")}
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPresetDeleteConfirmId(preset.id)}
                              >
                                {t("common.delete")}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      )}

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
              />
            </div>
            <div>
              <Label>{t("settingsManager.mcp.command")}</Label>
              <Input
                value={newServerCommand}
                onChange={(e) => setNewServerCommand(e.target.value)}
                placeholder="npx"
              />
            </div>
            <div>
              <Label>{t("settingsManager.mcp.args")}</Label>
              <Input
                value={newServerArgs}
                onChange={(e) => setNewServerArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-name"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>{t("settingsManager.mcp.envVars")}</Label>
                <Button variant="outline" size="sm" onClick={addEnvVar}>
                  + Add
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
                  <Button variant="ghost" size="sm" onClick={() => removeEnvVar(index)}>
                    ✕
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

      {/* Save as Preset Dialog */}
      <Dialog open={isSavePresetOpen} onOpenChange={setIsSavePresetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.mcp.saveAsPreset")}</DialogTitle>
            <DialogDescription>
              {t("settingsManager.mcp.savePresetDesc", { count: serverEntries.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="mcp-preset-name">{t("settingsManager.presets.name")}</Label>
            <Input
              id="mcp-preset-name"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder={t("settingsManager.presets.namePlaceholder")}
              className="mt-1.5"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPresetName.trim()) {
                  handleSaveAsPreset();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSavePresetOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSaveAsPreset}
              disabled={!newPresetName.trim() || presetsLoading}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Preset Confirmation Dialog */}
      <Dialog open={isLoadPresetConfirmOpen} onOpenChange={(open) => {
        setIsLoadPresetConfirmOpen(open);
        if (!open) setPendingPresetId(null);
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.mcp.loadPresetConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settingsManager.mcp.loadPresetConfirmDesc", {
                name: pendingPreset?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsLoadPresetConfirmOpen(false);
              setPendingPresetId(null);
            }}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConfirmLoadPreset}>
              {t("settingsManager.presets.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preset Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              {selectedPreset?.name}
            </DialogTitle>
            {selectedPreset?.description && (
              <DialogDescription>{selectedPreset.description}</DialogDescription>
            )}
          </DialogHeader>

          {selectedPreset && (() => {
            const summary = getPresetSummary(selectedPreset);
            return (
              <div className="space-y-4">
                {/* Metadata */}
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {formatMCPPresetDate(selectedPreset.createdAt)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Hash className="w-4 h-4" />
                    {t("settingsManager.mcp.serverCount", { count: summary.serverCount })}
                  </div>
                </div>

                {/* Server List */}
                <div className="bg-muted border rounded-lg p-4 max-h-[200px] overflow-auto">
                  <div className="text-sm font-medium mb-2">
                    {t("settingsManager.mcp.includedServers")}
                  </div>
                  <div className="space-y-2">
                    {Object.entries(summary.servers).map(([name, config]) => (
                      <div key={name} className="text-sm">
                        <code className="font-medium">{name}</code>
                        <span className="text-muted-foreground ml-2">
                          {config.command} {config.args?.join(" ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
              {t("common.close")}
            </Button>
            {!readOnly && (
              <Button onClick={() => {
                setIsDetailOpen(false);
                if (selectedPreset) {
                  handlePresetSelect(selectedPreset.id);
                }
              }}>
                {t("settingsManager.presets.apply")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

MCPServerManager.displayName = "MCPServerManager";
