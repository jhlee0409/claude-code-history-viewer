/**
 * SettingsManager Component
 *
 * Full-featured settings manager for Claude Code settings
 * Includes viewing, editing, presets, MCP management, and export/import
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { RefreshCw, Save, FolderOpen } from "lucide-react";
import { usePresets } from "@/hooks/usePresets";
import { useMCPServers } from "@/hooks/useMCPServers";
import type {
  AllSettingsResponse,
  SettingsScope,
  ClaudeCodeSettings,
  MCPServerConfig,
  MCPSource,
} from "@/types";
import { ScopeTabs } from "./components/ScopeTabs";
import { JsonSettingsEditor } from "./components/JsonSettingsEditor";
import { VisualSettingsEditor } from "./components/VisualSettingsEditor";
import { PresetManager } from "./components/PresetManager";
import { MCPServerManager } from "./components/MCPServerManager";
import { ExportImport } from "./components/ExportImport";
import { EmptyState } from "./components/EmptyState";

type EditorMode = "visual" | "json";
type FeatureTab = "editor" | "presets" | "mcp" | "exportImport";

interface SettingsManagerProps {
  projectPath?: string;
  className?: string;
}

export const SettingsManager: React.FC<SettingsManagerProps> = ({
  projectPath,
  className,
}) => {
  const { t } = useTranslation();
  const [settings, setSettings] = React.useState<AllSettingsResponse | null>(
    null
  );
  const [activeScope, setActiveScope] = React.useState<SettingsScope>("user");
  const [editorMode, setEditorMode] = React.useState<EditorMode>("visual");
  const [featureTab, setFeatureTab] = React.useState<FeatureTab>("editor");
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Preset integration state
  const [isSavePresetOpen, setIsSavePresetOpen] = React.useState(false);
  const [isLoadPresetConfirmOpen, setIsLoadPresetConfirmOpen] = React.useState(false);
  const [pendingPresetId, setPendingPresetId] = React.useState<string | null>(null);
  const [newPresetName, setNewPresetName] = React.useState("");
  const { presets, savePreset, isLoading: presetsLoading } = usePresets();

  const loadSettings = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const settingsResult = await invoke<AllSettingsResponse>("get_all_settings", { projectPath });
      setSettings(settingsResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const availableScopes = React.useMemo(() => {
    if (!settings) {
      return { user: false, project: false, local: false, managed: false };
    }
    return {
      user: settings.user !== null,
      project: settings.project !== null,
      local: settings.local !== null,
      managed: settings.managed !== null,
    };
  }, [settings]);

  const currentContent = settings?.[activeScope] ?? null;
  const currentSettings: ClaudeCodeSettings = React.useMemo(() => {
    if (!currentContent) return {};
    try {
      return JSON.parse(currentContent) as ClaudeCodeSettings;
    } catch {
      return {};
    }
  }, [currentContent]);

  const handleSave = React.useCallback(
    async (newSettings: ClaudeCodeSettings) => {
      try {
        await invoke("save_settings", {
          scope: activeScope,
          content: JSON.stringify(newSettings, null, 2),
          projectPath: activeScope !== "user" ? projectPath : undefined,
        });
        await loadSettings();
      } catch (err) {
        console.error("Failed to save settings:", err);
      }
    },
    [activeScope, projectPath, loadSettings]
  );

  // MCP source state
  const [mcpSource, setMcpSource] = React.useState<MCPSource>("user_settings");

  // Use the MCP servers hook for all sources
  const {
    userSettings: mcpUserSettings,
    userMcpFile: mcpUserMcpFile,
    projectMcpFile: mcpProjectMcpFile,
    saveMCPServers,
  } = useMCPServers(projectPath);

  // Get MCP servers for the selected source
  const mcpServersForSource = React.useMemo(() => {
    switch (mcpSource) {
      case "user_settings":
        return mcpUserSettings;
      case "user_mcp":
        return mcpUserMcpFile;
      case "project_mcp":
        return mcpProjectMcpFile;
      default:
        return {};
    }
  }, [mcpSource, mcpUserSettings, mcpUserMcpFile, mcpProjectMcpFile]);

  const handleMCPUpdate = React.useCallback(
    async (servers: Record<string, MCPServerConfig>) => {
      try {
        await saveMCPServers(mcpSource, servers);
      } catch (err) {
        console.error("Failed to save MCP settings:", err);
      }
    },
    [mcpSource, saveMCPServers]
  );

  const isReadOnly = activeScope === "managed";

  // Get pending preset for confirmation dialog
  const pendingPreset = React.useMemo(
    () => presets.find((p) => p.id === pendingPresetId) ?? null,
    [presets, pendingPresetId]
  );

  // Handle preset selection - show confirmation first
  const handlePresetSelect = React.useCallback((presetId: string) => {
    setPendingPresetId(presetId);
    setIsLoadPresetConfirmOpen(true);
  }, []);

  // Handle confirming preset load
  const handleConfirmLoadPreset = React.useCallback(async () => {
    if (!pendingPreset) return;

    try {
      const settings = JSON.parse(pendingPreset.settings) as ClaudeCodeSettings;
      await handleSave(settings);
    } catch (e) {
      console.error("Failed to parse preset settings:", e);
    } finally {
      setIsLoadPresetConfirmOpen(false);
      setPendingPresetId(null);
    }
  }, [pendingPreset, handleSave]);

  // Handle saving current settings as a preset
  const handleSaveAsPreset = React.useCallback(async () => {
    if (!newPresetName.trim()) return;

    await savePreset({
      name: newPresetName.trim(),
      settings: JSON.stringify(currentSettings, null, 2),
    });

    setNewPresetName("");
    setIsSavePresetOpen(false);
  }, [newPresetName, currentSettings, savePreset]);

  // Check if current settings are empty
  const isSettingsEmpty = Object.keys(currentSettings).length === 0;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("settingsManager.title")}</h2>
        <Button variant="ghost" size="sm" onClick={loadSettings}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("common.refresh")}
        </Button>
      </div>

      <LoadingState
        isLoading={isLoading}
        error={error}
        loadingMessage={t("settingsManager.loading")}
        spinnerSize="lg"
      >
        {/* Feature Tabs */}
        <Tabs
          value={featureTab}
          onValueChange={(v) => setFeatureTab(v as FeatureTab)}
          className="w-full"
        >
          <TabsList className="w-full justify-start mb-4">
            <TabsTrigger value="editor">
              {t("settingsManager.tabs.editor")}
            </TabsTrigger>
            <TabsTrigger value="presets">
              {t("settingsManager.tabs.presets")}
            </TabsTrigger>
            <TabsTrigger value="mcp">
              {t("settingsManager.tabs.mcp")}
            </TabsTrigger>
            <TabsTrigger value="exportImport">
              {t("settingsManager.tabs.exportImport")}
            </TabsTrigger>
          </TabsList>

          {/* Editor Tab */}
          <TabsContent value="editor">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base">
                    {t("settingsManager.scopeSettings")}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {/* Preset Quick Load */}
                    {presets.length > 0 && !isReadOnly && (
                      <Select onValueChange={handlePresetSelect}>
                        <SelectTrigger className="w-[160px] h-8 text-xs">
                          <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                          <SelectValue placeholder={t("settingsManager.presets.loadPreset")} />
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
                    {!isReadOnly && currentContent && !isSettingsEmpty && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsSavePresetOpen(true)}
                        className="h-8"
                      >
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                        {t("settingsManager.presets.saveAsPreset")}
                      </Button>
                    )}

                    {/* Mode Toggle */}
                    {!isReadOnly && currentContent && (
                      <div className="flex gap-1 border-l pl-2 ml-1">
                        <Button
                          variant={editorMode === "visual" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setEditorMode("visual")}
                          className="h-8"
                        >
                          {t("settingsManager.mode.visual")}
                        </Button>
                        <Button
                          variant={editorMode === "json" ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setEditorMode("json")}
                          className="h-8"
                        >
                          {t("settingsManager.mode.json")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {settings && (
                  <Tabs
                    value={activeScope}
                    onValueChange={(v) => setActiveScope(v as SettingsScope)}
                    className="w-full"
                  >
                    <ScopeTabs availableScopes={availableScopes} />

                    {(
                      ["user", "project", "local", "managed"] as SettingsScope[]
                    ).map((scope) => (
                      <TabsContent key={scope} value={scope} className="mt-4">
                        {settings[scope] === null ? (
                          <EmptyState scope={scope} />
                        ) : scope === "managed" ? (
                          <JsonSettingsEditor
                            initialContent={settings[scope] || "{}"}
                            scope={scope}
                            readOnly
                          />
                        ) : editorMode === "visual" ? (
                          <VisualSettingsEditor
                            settings={currentSettings}
                            scope={scope}
                            projectPath={projectPath}
                            onSave={handleSave}
                          />
                        ) : (
                          <JsonSettingsEditor
                            initialContent={settings[scope] || "{}"}
                            scope={scope}
                            projectPath={projectPath}
                            onSave={() => loadSettings()}
                          />
                        )}
                      </TabsContent>
                    ))}
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Presets Tab */}
          <TabsContent value="presets">
            <Card>
              <CardContent className="pt-6">
                <PresetManager
                  currentSettings={currentSettings}
                  activeScope={activeScope}
                  onApplyPreset={handleSave}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* MCP Tab */}
          <TabsContent value="mcp">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t("settingsManager.mcp.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs
                  value={mcpSource}
                  onValueChange={(v) => setMcpSource(v as MCPSource)}
                  className="w-full"
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="user_settings" className="flex-1 text-xs">
                      {t("settingsManager.mcp.sourceSettings")}
                    </TabsTrigger>
                    <TabsTrigger value="user_mcp" className="flex-1 text-xs">
                      {t("settingsManager.mcp.sourceUserMcp")}
                    </TabsTrigger>
                    {projectPath && (
                      <TabsTrigger value="project_mcp" className="flex-1 text-xs">
                        {t("settingsManager.mcp.sourceProjectMcp")}
                      </TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="user_settings" className="mt-4">
                    <MCPServerManager
                      servers={mcpServersForSource}
                      onUpdate={handleMCPUpdate}
                    />
                  </TabsContent>

                  <TabsContent value="user_mcp" className="mt-4">
                    <MCPServerManager
                      servers={mcpServersForSource}
                      onUpdate={handleMCPUpdate}
                    />
                  </TabsContent>

                  {projectPath && (
                    <TabsContent value="project_mcp" className="mt-4">
                      <MCPServerManager
                        servers={mcpServersForSource}
                        onUpdate={handleMCPUpdate}
                      />
                    </TabsContent>
                  )}
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Export/Import Tab */}
          <TabsContent value="exportImport">
            <ExportImport
              allSettings={settings}
              projectPath={projectPath}
              onImport={() => loadSettings()}
            />
          </TabsContent>
        </Tabs>
      </LoadingState>

      {/* Save as Preset Dialog */}
      <Dialog open={isSavePresetOpen} onOpenChange={setIsSavePresetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settingsManager.presets.saveAsPreset")}</DialogTitle>
            <DialogDescription>
              {t("settingsManager.presets.sourceScope")}: {t(`settingsManager.scope.${activeScope}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="quick-preset-name">{t("settingsManager.presets.name")}</Label>
            <Input
              id="quick-preset-name"
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
            <DialogTitle>{t("settingsManager.presets.loadPresetConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settingsManager.presets.loadPresetConfirmDesc", {
                name: pendingPreset?.name,
                scope: t(`settingsManager.scope.${activeScope}`),
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
    </div>
  );
};
