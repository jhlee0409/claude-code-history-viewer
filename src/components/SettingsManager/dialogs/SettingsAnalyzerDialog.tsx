/**
 * SettingsAnalyzerDialog Component
 *
 * Analyzes and visualizes the user's Claude Code settings distribution
 * across multiple configuration files. Provides:
 * - Visual overview of where settings are stored
 * - Best practice recommendations
 * - Full backup preset creation
 *
 * Design: Editorial/Magazine style with clear visual hierarchy
 */

import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  FolderTree,
  Home,
  Server,
  Shield,
  Zap,
  HelpCircle,
  ChevronRight,
  Package,
  Info,
  ExternalLink,
} from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { useUnifiedPresets } from "@/hooks/useUnifiedPresets";
import { mergeSettings } from "@/utils/settingsMerger";
import type { ClaudeCodeSettings, MCPServerConfig, UnifiedPresetInput } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface SettingsAnalyzerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileAnalysis {
  path: string;
  scope: "user" | "project" | "local" | "global";
  exists: boolean;
  settingsCount: number;
  mcpCount: number;
  hasPermissions: boolean;
  hasHooks: boolean;
  hasEnv: boolean;
  model?: string;
}

// ============================================================================
// Helper Components
// ============================================================================

const FileCard: React.FC<{
  analysis: FileAnalysis;
  isHighlighted?: boolean;
}> = ({ analysis, isHighlighted }) => {
  const { t } = useTranslation();

  const scopeColors: Record<string, string> = {
    global: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    user: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    project: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    local: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  };

  const scopeLabels: Record<string, string> = {
    global: t("settingsManager.analyzer.scope.global"),
    user: t("settingsManager.analyzer.scope.user"),
    project: t("settingsManager.analyzer.scope.project"),
    local: t("settingsManager.analyzer.scope.local"),
  };

  if (!analysis.exists) {
    return (
      <div className="relative p-3 rounded-lg border border-dashed border-border/50 bg-muted/20 opacity-50">
        <div className="flex items-start gap-3">
          <FileJson className="w-4 h-4 text-muted-foreground/50 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <code className="text-xs text-muted-foreground/60 font-mono break-all">
              {analysis.path}
            </code>
            <p className="text-[10px] text-muted-foreground/40 mt-1">
              {t("settingsManager.analyzer.fileNotFound")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative p-3 rounded-lg border transition-all duration-200 ${
        isHighlighted
          ? "border-accent/50 bg-accent/5 shadow-sm"
          : "border-border/50 bg-card hover:border-border"
      }`}
    >
      {/* Scope Badge */}
      <Badge
        variant="outline"
        className={`absolute -top-2 right-3 text-[9px] px-1.5 py-0 ${scopeColors[analysis.scope]}`}
      >
        {scopeLabels[analysis.scope]}
      </Badge>

      <div className="flex items-start gap-3">
        <FileJson className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <code className="text-xs text-foreground/80 font-mono break-all">
            {analysis.path}
          </code>

          {/* Content Summary */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {analysis.settingsCount > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5">
                {analysis.settingsCount} {t("settingsManager.analyzer.settings")}
              </Badge>
            )}
            {analysis.mcpCount > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5">
                <Server className="w-2.5 h-2.5 mr-1" />
                {analysis.mcpCount} MCP
              </Badge>
            )}
            {analysis.model && (
              <Badge variant="outline" className="text-[10px] h-5 font-mono">
                {analysis.model}
              </Badge>
            )}
            {analysis.hasPermissions && (
              <Badge variant="secondary" className="text-[10px] h-5">
                <Shield className="w-2.5 h-2.5 mr-1" />
                {t("settingsManager.analyzer.permissions")}
              </Badge>
            )}
            {analysis.hasHooks && (
              <Badge variant="secondary" className="text-[10px] h-5">
                <Zap className="w-2.5 h-2.5 mr-1" />
                {t("settingsManager.analyzer.hooks")}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const SettingsAnalyzerDialog: React.FC<SettingsAnalyzerDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const { allSettings, mcpServers, projectPath } = useSettingsManager();
  const { savePreset } = useUnifiedPresets();

  const [activeTab, setActiveTab] = useState("overview");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Analyze all settings files
  const analysis = useMemo(() => {
    const files: FileAnalysis[] = [];

    // Helper to analyze settings content
    const analyzeSettings = (
      content: string | null,
      path: string,
      scope: FileAnalysis["scope"]
    ): FileAnalysis => {
      if (!content) {
        return {
          path,
          scope,
          exists: false,
          settingsCount: 0,
          mcpCount: 0,
          hasPermissions: false,
          hasHooks: false,
          hasEnv: false,
        };
      }

      try {
        const settings = JSON.parse(content) as ClaudeCodeSettings;
        const keys = Object.keys(settings);

        return {
          path,
          scope,
          exists: true,
          settingsCount: keys.filter(
            (k) => k !== "mcpServers" && k !== "permissions" && k !== "hooks" && k !== "env"
          ).length,
          mcpCount: settings.mcpServers ? Object.keys(settings.mcpServers).length : 0,
          hasPermissions: !!settings.permissions,
          hasHooks: !!settings.hooks && Object.keys(settings.hooks).length > 0,
          hasEnv: !!settings.env && Object.keys(settings.env).length > 0,
          model: settings.model,
        };
      } catch {
        return {
          path,
          scope,
          exists: false,
          settingsCount: 0,
          mcpCount: 0,
          hasPermissions: false,
          hasHooks: false,
          hasEnv: false,
        };
      }
    };

    // Global (~/.claude.json) - MCP servers live here
    const globalMcpCount =
      Object.keys(mcpServers.userClaudeJson || {}).length;
    files.push({
      path: "~/.claude.json",
      scope: "global",
      exists: globalMcpCount > 0,
      settingsCount: 0,
      mcpCount: globalMcpCount,
      hasPermissions: false,
      hasHooks: false,
      hasEnv: false,
    });

    // User settings (~/.claude/settings.json)
    files.push(
      analyzeSettings(allSettings?.user || null, "~/.claude/settings.json", "user")
    );

    // Project settings
    if (projectPath) {
      files.push(
        analyzeSettings(
          allSettings?.project || null,
          ".claude/settings.json",
          "project"
        )
      );

      // Project MCP (.mcp.json)
      const projectMcpCount = Object.keys(mcpServers.projectMcpFile || {}).length;
      files.push({
        path: ".mcp.json",
        scope: "project",
        exists: projectMcpCount > 0,
        settingsCount: 0,
        mcpCount: projectMcpCount,
        hasPermissions: false,
        hasHooks: false,
        hasEnv: false,
      });

      // Local settings
      files.push(
        analyzeSettings(
          allSettings?.local || null,
          ".claude/settings.local.json",
          "local"
        )
      );
    }

    return files;
  }, [allSettings, mcpServers, projectPath]);

  // Summary statistics
  const summary = useMemo(() => {
    const existingFiles = analysis.filter((f) => f.exists);
    const totalSettings = analysis.reduce((sum, f) => sum + f.settingsCount, 0);
    const totalMcp = analysis.reduce((sum, f) => sum + f.mcpCount, 0);
    const hasFragmentation = existingFiles.length > 2;

    return {
      fileCount: existingFiles.length,
      totalSettings,
      totalMcp,
      hasFragmentation,
      existingFiles,
    };
  }, [analysis]);

  // Create full backup preset
  const handleCreateBackup = async () => {
    setIsSaving(true);
    try {
      // Merge all settings
      const effectiveSettings = allSettings ? mergeSettings(allSettings).effective : {};

      // Merge all MCP servers
      const allMcpServers: Record<string, MCPServerConfig> = {
        ...mcpServers.userClaudeJson,
        ...mcpServers.projectMcpFile,
        ...mcpServers.localClaudeJson,
      };

      const input: UnifiedPresetInput = {
        name: `Full Backup ${new Date().toLocaleDateString()}`,
        description: t("settingsManager.analyzer.backupDescription"),
        settings: JSON.stringify(effectiveSettings),
        mcpServers: JSON.stringify(allMcpServers),
      };

      await savePreset(input);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error("Failed to create backup:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FolderTree className="w-5 h-5 text-accent" />
            {t("settingsManager.analyzer.title")}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t("settingsManager.analyzer.description")}
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent h-auto p-0 shrink-0">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
            >
              {t("settingsManager.analyzer.tabs.overview")}
            </TabsTrigger>
            <TabsTrigger
              value="bestpractice"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
            >
              {t("settingsManager.analyzer.tabs.bestPractice")}
            </TabsTrigger>
            <TabsTrigger
              value="mcp"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
            >
              {t("settingsManager.analyzer.tabs.mcpGuide")}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent
            value="overview"
            className="flex-1 overflow-auto m-0 p-6 space-y-6"
          >
            {/* Status Banner */}
            <div
              className={`flex items-start gap-3 p-4 rounded-lg border ${
                summary.hasFragmentation
                  ? "bg-amber-500/5 border-amber-500/20"
                  : "bg-emerald-500/5 border-emerald-500/20"
              }`}
            >
              {summary.hasFragmentation ? (
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {summary.hasFragmentation
                    ? t("settingsManager.analyzer.status.fragmented", {
                        count: summary.fileCount,
                      })
                    : t("settingsManager.analyzer.status.organized")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settingsManager.analyzer.status.summary", {
                    settings: summary.totalSettings,
                    mcp: summary.totalMcp,
                  })}
                </p>
              </div>
            </div>

            {/* File List */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <FileJson className="w-4 h-4" />
                {t("settingsManager.analyzer.fileList")}
              </h3>
              <div className="space-y-3">
                {analysis.map((file, index) => (
                  <FileCard
                    key={index}
                    analysis={file}
                    isHighlighted={file.exists && file.mcpCount > 0}
                  />
                ))}
              </div>
            </div>

            {/* Backup Action */}
            <div className="border-t border-border/50 pt-4">
              <Button
                onClick={handleCreateBackup}
                disabled={isSaving || summary.totalSettings + summary.totalMcp === 0}
                className="w-full"
                variant={saveSuccess ? "outline" : "default"}
              >
                {saveSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
                    {t("settingsManager.analyzer.backupCreated")}
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4 mr-2" />
                    {isSaving
                      ? t("common.loading")
                      : t("settingsManager.analyzer.createBackup")}
                  </>
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                {t("settingsManager.analyzer.backupHint")}
              </p>
            </div>
          </TabsContent>

          {/* Best Practice Tab */}
          <TabsContent
            value="bestpractice"
            className="flex-1 overflow-auto m-0 p-6 space-y-6"
          >
            {/* Why Complex Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-amber-500" />
                {t("settingsManager.analyzer.whyComplex.title")}
              </h3>
              <div className="bg-muted/30 rounded-lg p-4 space-y-3 text-sm text-muted-foreground">
                <p>{t("settingsManager.analyzer.whyComplex.reason1")}</p>
                <p>{t("settingsManager.analyzer.whyComplex.reason2")}</p>
                <p>{t("settingsManager.analyzer.whyComplex.reason3")}</p>
              </div>
            </div>

            {/* Recommended Structure */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-emerald-500" />
                {t("settingsManager.analyzer.recommended.title")}
              </h3>
              <div className="bg-card border border-border/50 rounded-lg p-4 font-mono text-xs space-y-1">
                <div className="text-muted-foreground">
                  <span className="text-emerald-500">~/.claude/</span>
                </div>
                <div className="pl-4 flex items-center gap-2">
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                  <span>settings.json</span>
                  <Badge variant="outline" className="text-[9px] h-4">
                    {t("settingsManager.analyzer.recommended.globalSettings")}
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-3">
                  <span className="text-emerald-500">~/.claude.json</span>
                  <Badge variant="outline" className="text-[9px] h-4 ml-2">
                    {t("settingsManager.analyzer.recommended.globalMcp")}
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-3">
                  <span className="text-blue-500">your-project/</span>
                </div>
                <div className="pl-4 flex items-center gap-2">
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                  <span>.mcp.json</span>
                  <Badge variant="outline" className="text-[9px] h-4">
                    {t("settingsManager.analyzer.recommended.projectMcp")}
                  </Badge>
                </div>
                <div className="pl-4 flex items-center gap-2">
                  <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
                  <span>.claude/settings.json</span>
                  <Badge variant="outline" className="text-[9px] h-4">
                    {t("settingsManager.analyzer.recommended.teamSettings")}
                  </Badge>
                </div>
                <div className="pl-4 flex items-center gap-2 text-muted-foreground/60">
                  <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                  <span>.claude/settings.local.json</span>
                  <Badge variant="outline" className="text-[9px] h-4 opacity-50">
                    gitignore
                  </Badge>
                </div>
              </div>
            </div>

            {/* Priority Order */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-500" />
                {t("settingsManager.analyzer.priority.title")}
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary" className="bg-purple-500/10 text-purple-600">
                  Local
                </Badge>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
                  Project
                </Badge>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">
                  User
                </Badge>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
                  Global
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settingsManager.analyzer.priority.description")}
              </p>
            </div>

            {/* External Link */}
            <a
              href="https://code.claude.com/docs/en/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-accent hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {t("settingsManager.analyzer.officialDocs")}
            </a>
          </TabsContent>

          {/* MCP Guide Tab */}
          <TabsContent
            value="mcp"
            className="flex-1 overflow-auto m-0 p-6 space-y-6"
          >
            {/* MCP Locations */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4 text-purple-500" />
                {t("settingsManager.analyzer.mcp.title")}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <Home className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <code className="text-xs font-mono">~/.claude.json</code>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settingsManager.analyzer.mcp.global")}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                  <FolderTree className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <code className="text-xs font-mono">.mcp.json</code>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settingsManager.analyzer.mcp.project")}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Important Note */}
            <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {t("settingsManager.analyzer.mcp.warning.title")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settingsManager.analyzer.mcp.warning.description")}
                </p>
              </div>
            </div>

            {/* Per-Project Management */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">
                {t("settingsManager.analyzer.mcp.perProject.title")}
              </h3>
              <div className="bg-muted/30 rounded-lg p-4 space-y-3 text-xs text-muted-foreground">
                <p>{t("settingsManager.analyzer.mcp.perProject.desc1")}</p>
                <p>{t("settingsManager.analyzer.mcp.perProject.desc2")}</p>
                <div className="bg-card border border-border/50 rounded p-3 font-mono">
                  <p className="text-foreground/80">
                    # {t("settingsManager.analyzer.mcp.perProject.symlinkExample")}
                  </p>
                  <p className="text-emerald-500">
                    ln -s ~/.claude/project-configs/my-project .claude
                  </p>
                </div>
                <p>{t("settingsManager.analyzer.mcp.perProject.alternative")}</p>
              </div>
            </div>

            {/* Use Presets */}
            <div className="border-t border-border/50 pt-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/5 border border-accent/20">
                <Package className="w-8 h-8 text-accent shrink-0" />
                <div>
                  <p className="text-sm font-medium">
                    {t("settingsManager.analyzer.mcp.usePresets.title")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("settingsManager.analyzer.mcp.usePresets.description")}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
