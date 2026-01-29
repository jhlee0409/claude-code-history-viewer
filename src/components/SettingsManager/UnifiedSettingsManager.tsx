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
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading";
import { RefreshCw, FolderTree } from "lucide-react";
import { useMCPServers } from "@/hooks/useMCPServers";
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

  // Settings state
  const [allSettings, setAllSettings] = React.useState<AllSettingsResponse | null>(null);
  const [activeScope, setActiveScope] = React.useState<SettingsScope>("user");
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Project path state - allows changing project within the component
  const [projectPath, setProjectPath] = React.useState<string | undefined>(initialProjectPath);

  // Panel state
  const [activePanel, setActivePanel] = React.useState<ActivePanel>("editor");

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
      const settingsResult = await invoke<AllSettingsResponse>("get_all_settings", { projectPath });
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
        await invoke("save_settings", {
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
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-xl font-semibold">{t("settingsManager.title")}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant={activePanel === "diagnostics" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActivePanel(activePanel === "diagnostics" ? "editor" : "diagnostics")}
              className={activePanel === "diagnostics" ? "shadow-sm ring-1 ring-ring/20" : ""}
            >
              <FolderTree className="h-4 w-4 mr-2" />
              {t("settingsManager.diagnostics.button")}
            </Button>
            <Button variant="ghost" size="sm" onClick={loadSettings}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("common.refresh")}
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
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Left Sidebar */}
            <SettingsSidebar availableScopes={availableScopes} />

            {/* Main Content Area */}
            {activePanel === "editor" ? <SettingsEditorPane /> : <SettingsDiagnosticsPanel />}
          </div>
        )}
      </div>
    </SettingsManagerContext.Provider>
  );
};
