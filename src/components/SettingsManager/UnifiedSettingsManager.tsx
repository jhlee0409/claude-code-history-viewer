/**
 * UnifiedSettingsManager Component
 *
 * Refactored settings manager with improved UX:
 * - Sidebar for scope switching (always visible)
 * - Integrated preset panel
 * - Accordion sections for settings
 * - MCP servers as a section, not a tab
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { RefreshCw, FolderTree, Archive, ChevronRight } from "lucide-react";
import { useMCPServers } from "@/hooks/useMCPServers";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";
import type {
  AllSettingsResponse,
  SettingsScope,
  ClaudeCodeSettings,
  MCPServerConfig,
  MCPSource,
} from "@/types";
import { SettingsSidebar } from "./sidebar/SettingsSidebar";
import { SettingsEditorPane } from "./editor/SettingsEditorPane";
import { SettingsDiagnosticsPanel } from "./dialogs/SettingsDiagnosticsPanel";
import { CustomDirectoriesSection } from "./sections/CustomDirectoriesSection";
import { WslSection } from "./sections/WslSection";

export type ActivePanel = "editor" | "diagnostics";

// ============================================================================
// Types
// ============================================================================

interface UnifiedSettingsManagerProps {
  projectPath?: string;
  className?: string;
}

export interface SettingsManagerContextValue {
  // Settings state
  allSettings: AllSettingsResponse | null;
  activeScope: SettingsScope;
  setActiveScope: (scope: SettingsScope) => void;
  currentSettings: ClaudeCodeSettings;
  isReadOnly: boolean;
  projectPath?: string;
  setProjectPath: (path: string | undefined) => void;

  // Panel state
  activePanel: ActivePanel;
  setActivePanel: (panel: ActivePanel) => void;

  // Pending changes state (for dirty tracking across components)
  pendingSettings: ClaudeCodeSettings | null;
  setPendingSettings: React.Dispatch<React.SetStateAction<ClaudeCodeSettings | null>>;
  hasUnsavedChanges: boolean;

  // MCP state
  mcpServers: {
    userClaudeJson: Record<string, MCPServerConfig>;
    localClaudeJson: Record<string, MCPServerConfig>;
    userSettings: Record<string, MCPServerConfig>;
    userMcpFile: Record<string, MCPServerConfig>;
    projectMcpFile: Record<string, MCPServerConfig>;
  };
  saveMCPServers: (source: MCPSource, servers: Record<string, MCPServerConfig>, targetProjectPath?: string) => Promise<void>;

  // Actions
  loadSettings: () => Promise<void>;
  saveSettings: (settings: ClaudeCodeSettings, targetScope?: SettingsScope, targetProjectPath?: string) => Promise<void>;
}

// Create context
// eslint-disable-next-line react-refresh/only-export-components
export const SettingsManagerContext = React.createContext<SettingsManagerContextValue | null>(null);

// Hook to use context
// eslint-disable-next-line react-refresh/only-export-components
export const useSettingsManager = () => {
  const context = React.useContext(SettingsManagerContext);
  if (!context) {
    throw new Error("useSettingsManager must be used within UnifiedSettingsManager");
  }
  return context;
};

// ============================================================================
// Main Component
// ============================================================================

export const UnifiedSettingsManager: React.FC<UnifiedSettingsManagerProps> = ({
  projectPath: initialProjectPath,
  className,
}) => {
  const { t } = useTranslation();
  const { switchToArchive } = useAnalyticsNavigation();

  // Settings state
  const [allSettings, setAllSettings] = React.useState<AllSettingsResponse | null>(null);
  const [activeScope, setActiveScope] = React.useState<SettingsScope>("user");
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Project path state - allows changing project within the component
  const [projectPath, setProjectPath] = React.useState<string | undefined>(initialProjectPath);

  // Panel state
  const [activePanel, setActivePanel] = React.useState<ActivePanel>("editor");
  const [isCustomDirsExpanded, setIsCustomDirsExpanded] = React.useState(false);
  const [isWslExpanded, setIsWslExpanded] = React.useState(false);

  // Pending changes state (shared across components for dirty tracking)
  const [pendingSettings, setPendingSettings] = React.useState<ClaudeCodeSettings | null>(null);

  // Sync with initial prop if it changes
  React.useEffect(() => {
    setProjectPath(initialProjectPath);
  }, [initialProjectPath]);

  // MCP servers hook
  const {
    userClaudeJson: mcpUserClaudeJson,
    localClaudeJson: mcpLocalClaudeJson,
    userSettings: mcpUserSettings,
    userMcpFile: mcpUserMcpFile,
    projectMcpFile: mcpProjectMcpFile,
    saveMCPServers,
  } = useMCPServers(projectPath);

  // Load settings
  const loadSettings = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const settingsResult = await api<AllSettingsResponse>("get_all_settings", { projectPath });
      setAllSettings(settingsResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Parse current settings
  const currentSettings: ClaudeCodeSettings = React.useMemo(() => {
    const content = allSettings?.[activeScope] ?? null;
    if (!content) return {};
    try {
      return JSON.parse(content) as ClaudeCodeSettings;
    } catch {
      return {};
    }
  }, [allSettings, activeScope]);

  // Save settings (optionally to a specific target scope and project)
  const saveSettings = React.useCallback(
    async (newSettings: ClaudeCodeSettings, targetScope?: SettingsScope, targetProjectPath?: string) => {
      const scope = targetScope ?? activeScope;
      const effectiveProjectPath = targetProjectPath ?? projectPath;
      if (scope !== "user" && !effectiveProjectPath) {
        throw new Error("Project path is required for non-user scope settings");
      }
      try {
        await api("save_settings", {
          scope,
          content: JSON.stringify(newSettings, null, 2),
          projectPath: scope !== "user" ? effectiveProjectPath : undefined,
        });
        await loadSettings();
      } catch (err) {
        console.error("Failed to save settings:", err);
        throw err;
      }
    },
    [activeScope, projectPath, loadSettings]
  );

  const isReadOnly = activeScope === "managed";

  // Check if there are unsaved changes
  const hasUnsavedChanges = React.useMemo(() => {
    if (!pendingSettings) return false;
    return JSON.stringify(pendingSettings) !== JSON.stringify(currentSettings);
  }, [pendingSettings, currentSettings]);

  // Reset pending settings when scope changes
  React.useEffect(() => {
    setPendingSettings(null);
  }, [activeScope]);

  // Context value
  const contextValue: SettingsManagerContextValue = React.useMemo(
    () => ({
      allSettings,
      activeScope,
      setActiveScope,
      currentSettings,
      isReadOnly,
      projectPath,
      setProjectPath,
      activePanel,
      setActivePanel,
      pendingSettings,
      setPendingSettings,
      hasUnsavedChanges,
      mcpServers: {
        userClaudeJson: mcpUserClaudeJson,
        localClaudeJson: mcpLocalClaudeJson,
        userSettings: mcpUserSettings,
        userMcpFile: mcpUserMcpFile,
        projectMcpFile: mcpProjectMcpFile,
      },
      saveMCPServers,
      loadSettings,
      saveSettings,
    }),
    [
      allSettings,
      activeScope,
      currentSettings,
      isReadOnly,
      projectPath,
      activePanel,
      pendingSettings,
      hasUnsavedChanges,
      mcpUserClaudeJson,
      mcpLocalClaudeJson,
      mcpUserSettings,
      mcpUserMcpFile,
      mcpProjectMcpFile,
      saveMCPServers,
      loadSettings,
      saveSettings,
    ]
  );

  // Available scopes
  const availableScopes = React.useMemo(() => {
    if (!allSettings) {
      return { user: false, project: false, local: false, managed: false };
    }
    return {
      user: allSettings.user !== null,
      project: allSettings.project !== null,
      local: allSettings.local !== null,
      managed: allSettings.managed !== null,
    };
  }, [allSettings]);

  return (
    <SettingsManagerContext.Provider value={contextValue}>
      <div className={`flex flex-col ${className || ""}`}>
        {/* Archive Manager Link (mobile access point) */}
        <button
          type="button"
          onClick={switchToArchive}
          className="flex items-center gap-3 p-3 mb-4 rounded-lg border border-border/50 bg-card hover:bg-muted/50 transition-colors text-left w-full md:hidden"
        >
          <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center shrink-0">
            <Archive className="w-4 h-4 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("archive.settings.link")}</p>
            <p className="text-xs text-muted-foreground">{t("archive.settings.linkDescription")}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 shrink-0">
          <h2 className="text-xl font-semibold">{t("settingsManager.title")}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant={activePanel === "diagnostics" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActivePanel(activePanel === "diagnostics" ? "editor" : "diagnostics")}
              className={activePanel === "diagnostics" ? "shadow-sm ring-1 ring-ring/20" : ""}
            >
              <FolderTree className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">{t("settingsManager.diagnostics.button")}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={loadSettings}>
              <RefreshCw className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">{t("common.refresh")}</span>
            </Button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <LoadingState
            isLoading={isLoading}
            error={error}
            loadingMessage={t("settingsManager.loading")}
            spinnerSize="lg"
          />
        ) : error ? (
          <LoadingState
            isLoading={false}
            error={error}
          />
        ) : (
          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* Custom Directories — app-level setting, independent of Claude Code scope */}
            <Card className="shrink-0">
              <CustomDirectoriesSection
                isExpanded={isCustomDirsExpanded}
                onToggle={(open) => setIsCustomDirsExpanded(open)}
              />
            </Card>

            {/* WSL Settings — Windows Tauri only, hidden on other platforms */}
            <Card className="shrink-0">
              <WslSection
                isExpanded={isWslExpanded}
                onToggle={(open) => setIsWslExpanded(open)}
              />
            </Card>

            {/* Claude Code Settings */}
            <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
              {/* Left Sidebar */}
              <SettingsSidebar availableScopes={availableScopes} />

              {/* Main Content Area */}
              {activePanel === "editor" ? <SettingsEditorPane /> : <SettingsDiagnosticsPanel />}
            </div>
          </div>
        )}
      </div>
    </SettingsManagerContext.Provider>
  );
};
