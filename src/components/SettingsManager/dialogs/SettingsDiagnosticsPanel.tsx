/**
 * SettingsDiagnosticsPanel Component
 *
 * Panel-based diagnostics view scanning ALL projects and scopes.
 * Information architecture (based on UX research):
 *
 * - Health Summary Bar: fixed above tabs, severity pill counters
 * - 3 Tabs: Issues / Files / Guide
 * - Issues Tab: global section + per-project collapsible accordions
 *   (sorted by worst severity, errors auto-expanded, clean projects hidden)
 * - Files Tab: grouped by project
 * - Guide Tab: best practices + MCP guide merged
 */

import * as React from "react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileJson,
  FolderTree,
  HelpCircle,
  Home,
  Info,
  Loader2,
  Package,
  RefreshCw,
  Server,
  Shield,
  XCircle,
  Zap,
} from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { useUnifiedPresets } from "@/hooks/useUnifiedPresets";
import { mergeSettings } from "@/utils/settingsMerger";
import { detectSettingsIssues } from "@/utils/settingsIssueDetector";
import type { SettingsIssue, IssueSeverity } from "@/utils/settingsIssueDetector";
import type {
  AllSettingsResponse,
  ClaudeCodeSettings,
  ClaudeProject,
  MCPServerConfig,
  UnifiedPresetInput,
} from "@/types";
import { useAppStore } from "@/store/useAppStore";

// ============================================================================
// Types
// ============================================================================

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
  projectLabel?: string;
}

interface ProjectDiagnostics {
  projectName: string;
  projectPath: string;
  files: FileAnalysis[];
  issues: SettingsIssue[];
  worstSeverity: IssueSeverity | null;
}

type SaveResult = {
  type: "success" | "error";
  message: string;
} | null;

// ============================================================================
// Constants
// ============================================================================

const SCOPE_COLORS: Record<string, string> = {
  global: "bg-amber-500 text-white border-amber-500",
  user: "bg-blue-500 text-white border-blue-500",
  project: "bg-emerald-500 text-white border-emerald-500",
  local: "bg-purple-500 text-white border-purple-500",
};

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

// ============================================================================
// Analysis Helpers
// ============================================================================

function analyzeSettingsContent(
  content: string | null,
  path: string,
  scope: FileAnalysis["scope"],
  label?: string,
): FileAnalysis {
  if (!content || content === "{}") {
    return {
      path, scope, exists: content != null,
      settingsCount: 0, mcpCount: 0,
      hasPermissions: false, hasHooks: false, hasEnv: false,
      projectLabel: label,
    };
  }
  try {
    const settings = JSON.parse(content) as ClaudeCodeSettings;
    const keys = Object.keys(settings);
    return {
      path, scope, exists: true,
      settingsCount: keys.filter(
        (k) => k !== "mcpServers" && k !== "permissions" && k !== "hooks" && k !== "env",
      ).length,
      mcpCount: settings.mcpServers ? Object.keys(settings.mcpServers).length : 0,
      hasPermissions: !!settings.permissions,
      hasHooks: !!settings.hooks && Object.keys(settings.hooks).length > 0,
      hasEnv: !!settings.env && Object.keys(settings.env).length > 0,
      model: settings.model,
      projectLabel: label,
    };
  } catch {
    return {
      path, scope, exists: true,
      settingsCount: 0, mcpCount: 0,
      hasPermissions: false, hasHooks: false, hasEnv: false,
      projectLabel: label,
    };
  }
}

function buildProjectFiles(
  allSettings: AllSettingsResponse,
  label: string,
): FileAnalysis[] {
  const files: FileAnalysis[] = [];
  if (allSettings.project != null) {
    files.push(analyzeSettingsContent(allSettings.project, ".claude/settings.json", "project", label));
  }
  if (allSettings.local != null) {
    files.push(analyzeSettingsContent(allSettings.local, ".claude/settings.local.json", "local", label));
  }
  return files;
}

function worstSeverity(issues: SettingsIssue[]): IssueSeverity | null {
  if (issues.length === 0) return null;
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "info";
}

// ============================================================================
// Sub-Components
// ============================================================================

const FileCard = React.memo<{ analysis: FileAnalysis; isHighlighted?: boolean }>(
  ({ analysis, isHighlighted }) => {
    const { t } = useTranslation();

    if (!analysis.exists) {
      return (
        <div className="relative px-2.5 py-1.5 rounded-md border border-dashed border-border/50 bg-muted/20 opacity-50">
          <div className="flex items-center gap-2">
            <FileJson aria-hidden className="w-3 h-3 text-muted-foreground/50 shrink-0" />
            <code className="text-[10px] text-muted-foreground/60 font-mono break-all">{analysis.path}</code>
            <span className="text-[9px] text-muted-foreground/40">{t("settingsManager.analyzer.fileNotFound")}</span>
          </div>
        </div>
      );
    }

    return (
      <div className={`relative px-2.5 py-1.5 rounded-md border transition-all duration-200 ${isHighlighted ? "border-accent/50 bg-accent/5" : "border-border/50 bg-card hover:border-border"}`}>
        <Badge variant="outline" className={`absolute -top-1.5 right-2 text-[8px] px-1 py-0 leading-tight ${SCOPE_COLORS[analysis.scope]}`}>
          {t(`settingsManager.analyzer.scope.${analysis.scope}`)}
        </Badge>
        <div className="flex items-center gap-2">
          <FileJson aria-hidden className="w-3 h-3 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <code className="text-[10px] text-foreground/80 font-mono break-all">{analysis.path}</code>
              {analysis.projectLabel && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0">{analysis.projectLabel}</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {analysis.settingsCount > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                  {analysis.settingsCount} {t("settingsManager.analyzer.settings")}
                </Badge>
              )}
              {analysis.mcpCount > 0 && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                  <Server aria-hidden className="w-2 h-2 mr-0.5" />{analysis.mcpCount} MCP
                </Badge>
              )}
              {analysis.model && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">{analysis.model}</Badge>
              )}
              {analysis.hasPermissions && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                  <Shield aria-hidden className="w-2 h-2 mr-0.5" />{t("settingsManager.analyzer.permissions")}
                </Badge>
              )}
              {analysis.hasHooks && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1">
                  <Zap aria-hidden className="w-2 h-2 mr-0.5" />{t("settingsManager.analyzer.hooks")}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);
FileCard.displayName = "FileCard";

const SEVERITY_ICON: Record<IssueSeverity, { Icon: typeof XCircle; className: string }> = {
  error: { Icon: XCircle, className: "text-destructive" },
  warning: { Icon: AlertTriangle, className: "text-amber-500" },
  info: { Icon: Info, className: "text-blue-500" },
};

const SEVERITY_BORDER: Record<IssueSeverity, string> = {
  error: "border-destructive/30 bg-destructive/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  info: "border-blue-500/20 bg-blue-500/5",
};

const IssueCard = React.memo<{ issue: SettingsIssue }>(({ issue }) => {
  const { t } = useTranslation();
  const { Icon, className: iconClass } = SEVERITY_ICON[issue.severity];
  return (
    <div className={`px-2.5 py-2 rounded-md border ${SEVERITY_BORDER[issue.severity]}`}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconClass}`} />
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-medium">{t(issue.titleKey)}</p>
          <p className="text-[10px] text-muted-foreground leading-tight">{t(issue.descriptionKey, issue.descriptionParams ?? {})}</p>
          <div className="flex flex-wrap gap-0.5">
            {issue.affectedScopes.map((scope) => (
              <Badge key={scope} variant="outline" className={`text-[8px] px-1 py-0 ${SCOPE_COLORS[scope] ?? ""}`}>
                {t(`settingsManager.analyzer.scope.${scope}`)}
              </Badge>
            ))}
          </div>
          <p className="text-[9px] italic text-muted-foreground/70 leading-tight">{t(issue.recommendationKey)}</p>
        </div>
      </div>
    </div>
  );
});
IssueCard.displayName = "IssueCard";

/** Collapsible project section for issues tab */
const ProjectIssueGroup = React.memo<{
  pd: ProjectDiagnostics;
  defaultOpen: boolean;
}>(({ pd, defaultOpen }) => {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);
  const errors = pd.issues.filter((i) => i.severity === "error").length;
  const warnings = pd.issues.filter((i) => i.severity === "warning").length;
  const infos = pd.issues.filter((i) => i.severity === "info").length;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left">
        {open ? (
          <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium flex-1 truncate">{pd.projectName}</span>
        <div className="flex items-center gap-1 shrink-0">
          {errors > 0 && (
            <Badge variant="secondary" className="text-[9px] h-3.5 px-1 bg-destructive/10 text-destructive">
              {errors}
            </Badge>
          )}
          {warnings > 0 && (
            <Badge variant="secondary" className="text-[9px] h-3.5 px-1 bg-amber-500/10 text-amber-600">
              {warnings}
            </Badge>
          )}
          {infos > 0 && (
            <Badge variant="secondary" className="text-[9px] h-3.5 px-1 bg-blue-500/10 text-blue-600">
              {infos}
            </Badge>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-5 pr-1 pb-1.5 space-y-1.5">
          {pd.issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
ProjectIssueGroup.displayName = "ProjectIssueGroup";

/** Health summary bar with severity pill counters */
const HealthBar: React.FC<{
  errors: number;
  warnings: number;
  infos: number;
  projectsScanned: number;
  isScanning: boolean;
  onRescan: () => void;
}> = ({ errors, warnings, infos, projectsScanned, isScanning, onRescan }) => {
  const { t } = useTranslation();
  const total = errors + warnings + infos;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-muted/20 shrink-0">
      <div className="flex items-center gap-2 flex-1">
        {isScanning ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : total === 0 ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        ) : errors > 0 ? (
          <XCircle className="w-4 h-4 text-destructive" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500" />
        )}
        <div className="flex items-center gap-1.5">
          {errors > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 bg-destructive/10 text-destructive">
              {t("settingsManager.diagnostics.errorCount", { count: errors })}
            </Badge>
          )}
          {warnings > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 bg-amber-500/10 text-amber-600">
              {t("settingsManager.diagnostics.warningCount", { count: warnings })}
            </Badge>
          )}
          {infos > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 bg-blue-500/10 text-blue-600">
              {t("settingsManager.diagnostics.infoCount", { count: infos })}
            </Badge>
          )}
          {!isScanning && total === 0 && (
            <span className="text-xs text-emerald-600">{t("settingsManager.analyzer.issues.noIssues")}</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0">
        {t("settingsManager.diagnostics.projectsScanned", { count: projectsScanned })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onRescan}
        disabled={isScanning}
        aria-label={t("settingsManager.diagnostics.rescan")}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const SettingsDiagnosticsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { allSettings, mcpServers, setActivePanel } = useSettingsManager();
  const { savePreset } = useUnifiedPresets();
  const claudePath = useAppStore((s) => s.claudePath);

  const [activeTab, setActiveTab] = useState("issues");
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<SaveResult>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [projectDiagnostics, setProjectDiagnostics] = useState<ProjectDiagnostics[]>([]);
  const [totalProjectsScanned, setTotalProjectsScanned] = useState(0);
  const [scanKey, setScanKey] = useState(0);

  // Auto-dismiss save result
  useEffect(() => {
    if (saveResult) {
      const timer = setTimeout(() => setSaveResult(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveResult]);

  // Scan all projects
  useEffect(() => {
    let cancelled = false;

    async function scanAll() {
      if (!claudePath) return;
      setIsScanning(true);
      try {
        const projects = await invoke<ClaudeProject[]>("scan_projects", { claudePath });
        if (cancelled) return;
        setTotalProjectsScanned(projects.length);

        const results: ProjectDiagnostics[] = [];
        for (const project of projects) {
          if (cancelled) return;
          try {
            const settings = await invoke<AllSettingsResponse>("get_all_settings", {
              projectPath: project.actual_path,
            });
            const label = project.actual_path.split(/[\\/]/).pop() ?? project.name;
            const files = buildProjectFiles(settings, label);
            // Only detect project/local scope issues — user scope handled by globalIssues
            const projectLocalOnly: AllSettingsResponse = {
              user: null, project: settings.project, local: settings.local, managed: null,
            };
            const mergedProjectLocal = mergeSettings(projectLocalOnly);
            const issues = detectSettingsIssues(projectLocalOnly, null, mergedProjectLocal);

            if (files.some((f) => f.exists) || issues.length > 0) {
              results.push({
                projectName: label,
                projectPath: project.actual_path,
                files,
                issues,
                worstSeverity: worstSeverity(issues),
              });
            }
          } catch {
            // Skip projects that fail to load
          }
        }

        if (!cancelled) {
          // Sort by worst severity: errors first, then warnings, then info, then files-only
          results.sort((a, b) => {
            const sa = a.worstSeverity ? SEVERITY_ORDER[a.worstSeverity] : 3;
            const sb = b.worstSeverity ? SEVERITY_ORDER[b.worstSeverity] : 3;
            return sa - sb;
          });
          setProjectDiagnostics(results);
        }
      } catch (err) {
        console.error("Failed to scan projects for diagnostics:", err);
      } finally {
        if (!cancelled) setIsScanning(false);
      }
    }

    scanAll();
    return () => { cancelled = true; };
  }, [claudePath, scanKey]);

  const handleRescan = useCallback(() => setScanKey((k) => k + 1), []);

  // Global files (user-level)
  const globalFiles = useMemo(() => {
    const files: FileAnalysis[] = [];
    const globalMcpServers = mcpServers.userClaudeJson || {};
    const globalMcpCount = Object.keys(globalMcpServers).length;
    files.push({
      path: "~/.claude.json", scope: "global",
      exists: globalMcpCount > 0 || mcpServers.userClaudeJson != null,
      settingsCount: 0, mcpCount: globalMcpCount,
      hasPermissions: false, hasHooks: false, hasEnv: false,
    });
    files.push(analyzeSettingsContent(allSettings?.user || null, "~/.claude/settings.json", "user"));
    return files;
  }, [allSettings, mcpServers]);

  // Global-level issues
  const globalIssues = useMemo(() => {
    if (!allSettings) return [];
    const userOnly: AllSettingsResponse = {
      user: allSettings.user, project: null, local: null, managed: allSettings.managed,
    };
    const merged = mergeSettings(userOnly);
    return detectSettingsIssues(userOnly, mcpServers, merged);
  }, [allSettings, mcpServers]);

  // Aggregated counts
  const issueCounts = useMemo(() => {
    let errors = globalIssues.filter((i) => i.severity === "error").length;
    let warnings = globalIssues.filter((i) => i.severity === "warning").length;
    let infos = globalIssues.filter((i) => i.severity === "info").length;
    for (const pd of projectDiagnostics) {
      errors += pd.issues.filter((i) => i.severity === "error").length;
      warnings += pd.issues.filter((i) => i.severity === "warning").length;
      infos += pd.issues.filter((i) => i.severity === "info").length;
    }
    return { errors, warnings, infos, total: errors + warnings + infos };
  }, [globalIssues, projectDiagnostics]);

  // Projects with and without issues
  const projectsWithIssues = useMemo(
    () => projectDiagnostics.filter((pd) => pd.issues.length > 0),
    [projectDiagnostics],
  );
  const cleanProjectCount = totalProjectsScanned - projectsWithIssues.length;

  // Summary for guide tab
  const summary = useMemo(() => {
    const allFiles = [...globalFiles];
    for (const pd of projectDiagnostics) allFiles.push(...pd.files);
    const totalSettings = allFiles.reduce((sum, f) => sum + f.settingsCount, 0);
    const totalMcp = allFiles.reduce((sum, f) => sum + f.mcpCount, 0);
    const hasIssues = issueCounts.total > 0;
    const hasMcpInSettings = globalIssues.some((i) => i.type === "mcp_in_settings")
      || projectDiagnostics.some((pd) => pd.issues.some((i) => i.type === "mcp_in_settings"));
    return { totalSettings, totalMcp, hasIssues, hasMcpInSettings };
  }, [globalFiles, projectDiagnostics, issueCounts, globalIssues]);

  // Backup
  const handleCreateBackup = useCallback(async () => {
    setIsSaving(true);
    setSaveResult(null);
    try {
      const effectiveSettings = allSettings ? mergeSettings(allSettings).effective : {};
      const allMcpServers: Record<string, MCPServerConfig> = {
        ...mcpServers.userClaudeJson,
        ...mcpServers.projectMcpFile,
        ...mcpServers.localClaudeJson,
      };
      const input: UnifiedPresetInput = {
        name: t("settingsManager.analyzer.backupName", { date: new Date().toLocaleDateString() }),
        description: t("settingsManager.analyzer.backupDescription"),
        settings: JSON.stringify(effectiveSettings),
        mcpServers: JSON.stringify(allMcpServers),
      };
      await savePreset(input);
      setSaveResult({ type: "success", message: t("settingsManager.analyzer.backupCreated") });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setSaveResult({ type: "error", message: t("settingsManager.analyzer.backupError", { error: errorMessage }) });
    } finally {
      setIsSaving(false);
    }
  }, [allSettings, mcpServers, savePreset, t]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 shrink-0">
        <Button
          variant="ghost" size="sm" className="h-8 w-8 p-0"
          onClick={() => setActivePanel("editor")}
          aria-label={t("settingsManager.diagnostics.backToEditor")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2">
          <FolderTree aria-hidden className="w-5 h-5 text-accent" />
          <h3 className="text-lg font-semibold">{t("settingsManager.diagnostics.title")}</h3>
        </div>
      </div>

      {/* Health Summary Bar */}
      <HealthBar
        errors={issueCounts.errors}
        warnings={issueCounts.warnings}
        infos={issueCounts.infos}
        projectsScanned={totalProjectsScanned}
        isScanning={isScanning}
        onRescan={handleRescan}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent h-auto p-0 shrink-0">
          <TabsTrigger
            value="issues"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
          >
            {t("settingsManager.diagnostics.tabs.issues")}
            {issueCounts.total > 0 && (
              <Badge variant="secondary" className={`ml-2 text-[10px] h-4 px-1.5 ${issueCounts.errors > 0 ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600"}`}>
                {issueCounts.total}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
          >
            {t("settingsManager.diagnostics.tabs.files")}
          </TabsTrigger>
          <TabsTrigger
            value="guide"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:bg-transparent px-4 py-2.5 text-sm"
          >
            {t("settingsManager.diagnostics.tabs.guide")}
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* Issues Tab */}
        {/* ============================================================ */}
        <TabsContent value="issues" className="flex-1 overflow-auto m-0 p-4 space-y-4">
          {/* Global Issues Section */}
          {globalIssues.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("settingsManager.diagnostics.globalScope")}
              </h4>
              {globalIssues.map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}

          {/* Per-project collapsible groups */}
          {projectsWithIssues.length > 0 && (
            <div className="space-y-1">
              {globalIssues.length > 0 && <hr className="border-border/50 my-2" />}
              {projectsWithIssues.map((pd) => (
                <ProjectIssueGroup
                  key={pd.projectPath}
                  pd={pd}
                  defaultOpen={pd.worstSeverity === "error"}
                />
              ))}
            </div>
          )}

          {/* Clean projects footer */}
          {!isScanning && cleanProjectCount > 0 && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              {t("settingsManager.diagnostics.projectsClean", { count: cleanProjectCount })}
            </p>
          )}

          {/* All clean */}
          {!isScanning && issueCounts.total === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
              <p className="text-sm font-medium">{t("settingsManager.analyzer.issues.noIssues")}</p>
            </div>
          )}

          {/* Scanning state */}
          {isScanning && (
            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          )}
        </TabsContent>

        {/* ============================================================ */}
        {/* Files Tab */}
        {/* ============================================================ */}
        <TabsContent value="files" className="flex-1 overflow-auto m-0 p-4 space-y-5">
          {/* Global files */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("settingsManager.diagnostics.globalScope")}
            </h4>
            {globalFiles.map((file) => (
              <FileCard key={file.path + file.scope} analysis={file} isHighlighted={file.exists && file.mcpCount > 0} />
            ))}
          </div>

          {/* Per-project files (hide empty projects and empty files) */}
          {projectDiagnostics.map((pd) => {
            const nonEmptyFiles = pd.files.filter(
              (f) => f.exists && (f.settingsCount > 0 || f.mcpCount > 0 || f.hasPermissions || f.hasHooks || f.hasEnv || f.model),
            );
            if (nonEmptyFiles.length === 0) return null;
            return (
              <div key={pd.projectPath} className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground truncate">{pd.projectName}</h4>
                {nonEmptyFiles.map((file) => (
                  <FileCard
                    key={`${pd.projectPath}_${file.path}_${file.scope}`}
                    analysis={{...file, projectLabel: undefined}}
                    isHighlighted={file.mcpCount > 0}
                  />
                ))}
              </div>
            );
          })}

          {isScanning && (
            <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          )}

          {/* Backup */}
          <div className="border-t border-border/50 pt-4 space-y-2">
            <Button
              onClick={handleCreateBackup}
              disabled={isSaving || summary.totalSettings + summary.totalMcp === 0}
              className="w-full"
              variant={saveResult?.type === "success" ? "outline" : "default"}
            >
              {saveResult?.type === "success" ? (
                <>
                  <CheckCircle2 aria-hidden className="w-4 h-4 mr-2 text-emerald-500" />
                  {saveResult.message}
                </>
              ) : (
                <>
                  <Package aria-hidden className="w-4 h-4 mr-2" />
                  {isSaving ? t("common.loading") : t("settingsManager.analyzer.createBackup")}
                </>
              )}
            </Button>
            {saveResult?.type === "error" && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">
                <XCircle aria-hidden className="w-3.5 h-3.5 shrink-0" />
                <span>{saveResult.message}</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground text-center">{t("settingsManager.analyzer.backupHint")}</p>
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/* Guide Tab */}
        {/* ============================================================ */}
        <TabsContent value="guide" className="flex-1 overflow-auto m-0 p-6 space-y-6">
          {/* Why Complex */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <HelpCircle aria-hidden className="w-4 h-4 text-amber-500" />
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
              <FolderTree aria-hidden className="w-4 h-4 text-emerald-500" />
              {t("settingsManager.analyzer.recommended.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {summary.hasIssues
                ? t("settingsManager.analyzer.recommended.currentMismatch")
                : t("settingsManager.analyzer.recommended.currentMatch")}
            </p>
            <div className="bg-card border border-border/50 rounded-lg p-4 font-mono text-xs space-y-1">
              <div className="text-muted-foreground"><span className="text-emerald-500">~/.claude/</span></div>
              <div className="pl-4 flex items-center gap-2">
                <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground/50" />
                <span>settings.json</span>
                <Badge variant="outline" className="text-[9px] h-4">{t("settingsManager.analyzer.recommended.globalSettings")}</Badge>
              </div>
              <div className="text-muted-foreground mt-3">
                <span className="text-emerald-500">~/.claude.json</span>
                <Badge variant="outline" className="text-[9px] h-4 ml-2">{t("settingsManager.analyzer.recommended.globalMcp")}</Badge>
              </div>
              <div className="text-muted-foreground mt-3"><span className="text-blue-500">your-project/</span></div>
              <div className="pl-4 flex items-center gap-2">
                <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground/50" />
                <span>.mcp.json</span>
                <Badge variant="outline" className="text-[9px] h-4">{t("settingsManager.analyzer.recommended.projectMcp")}</Badge>
              </div>
              <div className="pl-4 flex items-center gap-2">
                <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground/50" />
                <span>.claude/settings.json</span>
                <Badge variant="outline" className="text-[9px] h-4">{t("settingsManager.analyzer.recommended.teamSettings")}</Badge>
              </div>
              <div className="pl-4 flex items-center gap-2 text-muted-foreground/60">
                <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground/30" />
                <span>.claude/settings.local.json</span>
                <Badge variant="outline" className="text-[9px] h-4 opacity-50">gitignore</Badge>
              </div>
            </div>
          </div>

          {/* Priority Order */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Info aria-hidden className="w-4 h-4 text-blue-500" />
              {t("settingsManager.analyzer.priority.title")}
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="bg-purple-500/10 text-purple-600">{t("settingsManager.analyzer.scope.local")}</Badge>
              <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground" />
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">{t("settingsManager.analyzer.scope.project")}</Badge>
              <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground" />
              <Badge variant="secondary" className="bg-blue-500/10 text-blue-600">{t("settingsManager.analyzer.scope.user")}</Badge>
              <ChevronRight aria-hidden className="w-3 h-3 text-muted-foreground" />
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">{t("settingsManager.analyzer.scope.global")}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t("settingsManager.analyzer.priority.description")}</p>
          </div>

          <hr className="border-border/50" />

          {/* MCP Guide */}
          {summary.hasMcpInSettings && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle aria-hidden className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-destructive">{t("settingsManager.analyzer.status.mcpInSettings")}</p>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Server aria-hidden className="w-4 h-4 text-purple-500" />
              {t("settingsManager.analyzer.mcp.title")}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <Home aria-hidden className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <code className="text-xs font-mono">~/.claude.json</code>
                  <p className="text-xs text-muted-foreground mt-1">{t("settingsManager.analyzer.mcp.global")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <FolderTree aria-hidden className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <code className="text-xs font-mono">.mcp.json</code>
                  <p className="text-xs text-muted-foreground mt-1">{t("settingsManager.analyzer.mcp.project")}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
            <AlertTriangle aria-hidden className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">{t("settingsManager.analyzer.mcp.warning.title")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("settingsManager.analyzer.mcp.warning.description")}</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t("settingsManager.analyzer.mcp.perProject.title")}</h3>
            <div className="bg-muted/30 rounded-lg p-4 space-y-3 text-xs text-muted-foreground">
              <p>{t("settingsManager.analyzer.mcp.perProject.desc1")}</p>
              <p>{t("settingsManager.analyzer.mcp.perProject.desc2")}</p>
              <div className="bg-card border border-border/50 rounded p-3 font-mono">
                <p className="text-foreground/80"># {t("settingsManager.analyzer.mcp.perProject.symlinkExample")}</p>
                <p className="text-emerald-500">ln -s ~/.claude/project-configs/my-project .claude</p>
              </div>
              <p>{t("settingsManager.analyzer.mcp.perProject.alternative")}</p>
            </div>
          </div>

          <div className="border-t border-border/50 pt-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/5 border border-accent/20">
              <Package aria-hidden className="w-8 h-8 text-accent shrink-0" />
              <div>
                <p className="text-sm font-medium">{t("settingsManager.analyzer.mcp.usePresets.title")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("settingsManager.analyzer.mcp.usePresets.description")}</p>
              </div>
            </div>
          </div>

          <a
            href="https://code.claude.com/docs/en/settings"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-accent hover:underline"
            aria-label={t("settingsManager.analyzer.officialDocs")}
          >
            <ExternalLink aria-hidden className="w-3 h-3" />
            {t("settingsManager.analyzer.officialDocs")}
          </a>
        </TabsContent>
      </Tabs>
    </div>
  );
};
