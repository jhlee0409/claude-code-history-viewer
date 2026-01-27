/**
 * SettingsCommandPalette Component
 *
 * Quick access to settings via ⌘K command palette.
 * Features:
 * - Search settings sections (General, MCP, Permissions, etc.)
 * - Quick apply presets
 * - Jump to specific settings
 * - Recent actions
 */

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Settings2,
  Server,
  Shield,
  Terminal,
  Variable,
  Play,
  Clock,
  Sparkles,
  FolderOpen,
  User,
  FileCode,
  Building2,
} from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import type { SettingsScope } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface CommandAction {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  keywords?: string[];
  shortcut?: string;
  action: () => void;
}

interface SettingsCommandPaletteProps {
  onSectionJump?: (sectionId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export const SettingsCommandPalette: React.FC<SettingsCommandPaletteProps> = ({
  onSectionJump,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [recentActions, setRecentActions] = useState<string[]>([]);

  const {
    settingsPresets,
    mcpPresets,
    setActiveScope,
    setProjectPath,
    saveSettings,
    isReadOnly,
  } = useSettingsManager();

  // Load recent actions from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("settings-command-recent");
    if (stored) {
      try {
        setRecentActions(JSON.parse(stored));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save recent action
  const trackAction = useCallback((actionId: string) => {
    setRecentActions((prev) => {
      const next = [actionId, ...prev.filter((id) => id !== actionId)].slice(0, 5);
      localStorage.setItem("settings-command-recent", JSON.stringify(next));
      return next;
    });
  }, []);

  // Keyboard shortcut handler
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Build actions list
  const actions = useMemo(() => {
    const result: { sections: CommandAction[]; presets: CommandAction[]; scopes: CommandAction[] } = {
      sections: [],
      presets: [],
      scopes: [],
    };

    // Section navigation
    const sections = [
      { id: "general", icon: <Settings2 className="w-4 h-4" />, label: t("settingsManager.unified.sections.general") },
      { id: "mcp", icon: <Server className="w-4 h-4" />, label: t("settingsManager.mcp.title") },
      { id: "permissions", icon: <Shield className="w-4 h-4" />, label: t("settingsManager.unified.sections.permissions") },
      { id: "hooks", icon: <Terminal className="w-4 h-4" />, label: t("settingsManager.unified.sections.hooks") },
      { id: "env", icon: <Variable className="w-4 h-4" />, label: t("settingsManager.unified.sections.env") },
    ];

    result.sections = sections.map((section) => ({
      id: `section-${section.id}`,
      label: section.label,
      description: t("settingsManager.command.jumpTo", { section: section.label }),
      icon: section.icon,
      keywords: [section.id, section.label.toLowerCase()],
      action: () => {
        onSectionJump?.(section.id);
        trackAction(`section-${section.id}`);
        setOpen(false);
      },
    }));

    // Settings presets
    if (settingsPresets.presets.length > 0) {
      result.presets = settingsPresets.presets.map((preset) => ({
        id: `preset-settings-${preset.id}`,
        label: preset.name,
        description: preset.description || t("settingsManager.presets.apply"),
        icon: <Sparkles className="w-4 h-4 text-blue-500" />,
        keywords: ["preset", "settings", preset.name.toLowerCase()],
        action: async () => {
          if (isReadOnly) return;
          try {
            const settings = JSON.parse(preset.settings);
            await saveSettings(settings);
            trackAction(`preset-settings-${preset.id}`);
          } catch (e) {
            console.error("Failed to apply preset:", e);
          }
          setOpen(false);
        },
      }));
    }

    // MCP presets
    if (mcpPresets.presets.length > 0) {
      const mcpPresetActions: CommandAction[] = mcpPresets.presets.map((preset) => ({
        id: `preset-mcp-${preset.id}`,
        label: preset.name,
        description: preset.description || t("settingsManager.mcp.loadPresetConfirmTitle"),
        icon: <Server className="w-4 h-4 text-purple-500" />,
        keywords: ["preset", "mcp", "server", preset.name.toLowerCase()],
        action: () => {
          // MCP presets need the dialog for scope selection
          trackAction(`preset-mcp-${preset.id}`);
          setOpen(false);
        },
      }));
      result.presets.push(...mcpPresetActions);
    }

    // Scope switching
    const scopes: { id: SettingsScope; icon: React.ReactNode; label: string }[] = [
      { id: "user", icon: <User className="w-4 h-4" />, label: t("settingsManager.scope.user") },
      { id: "project", icon: <FolderOpen className="w-4 h-4" />, label: t("settingsManager.scope.project") },
      { id: "local", icon: <FileCode className="w-4 h-4" />, label: t("settingsManager.scope.local") },
      { id: "managed", icon: <Building2 className="w-4 h-4" />, label: t("settingsManager.scope.managed") },
    ];

    result.scopes = scopes.map((scope) => ({
      id: `scope-${scope.id}`,
      label: `${t("settingsManager.command.switchTo")} ${scope.label}`,
      icon: scope.icon,
      keywords: ["scope", "switch", scope.id, scope.label.toLowerCase()],
      shortcut: scope.id === "user" ? "⌘1" : scope.id === "project" ? "⌘2" : scope.id === "local" ? "⌘3" : undefined,
      action: () => {
        setActiveScope(scope.id);
        if (scope.id === "user") {
          setProjectPath(undefined);
        }
        trackAction(`scope-${scope.id}`);
        setOpen(false);
      },
    }));

    return result;
  }, [t, settingsPresets.presets, mcpPresets.presets, onSectionJump, trackAction, saveSettings, isReadOnly, setActiveScope, setProjectPath]);

  // Get recent actions as full action objects
  const recentActionObjects = useMemo(() => {
    const allActions = [...actions.sections, ...actions.presets, ...actions.scopes];
    return recentActions
      .map((id) => allActions.find((a) => a.id === id))
      .filter(Boolean) as CommandAction[];
  }, [recentActions, actions]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t("settingsManager.command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("settingsManager.command.noResults")}</CommandEmpty>

        {/* Recent Actions */}
        {recentActionObjects.length > 0 && (
          <>
            <CommandGroup heading={t("settingsManager.command.recent")}>
              {recentActionObjects.map((action) => (
                <CommandItem
                  key={action.id}
                  value={action.id}
                  onSelect={action.action}
                  keywords={action.keywords}
                >
                  <Clock className="w-4 h-4 mr-2 text-muted-foreground" />
                  {action.icon}
                  <span className="ml-2">{action.label}</span>
                  {action.shortcut && (
                    <CommandShortcut>{action.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Sections */}
        <CommandGroup heading={t("settingsManager.command.sections")}>
          {actions.sections.map((action) => (
            <CommandItem
              key={action.id}
              value={action.id}
              onSelect={action.action}
              keywords={action.keywords}
            >
              {action.icon}
              <span className="ml-2">{action.label}</span>
              {action.description && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {action.description}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Presets */}
        {actions.presets.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("settingsManager.command.presets")}>
              {actions.presets.map((action) => (
                <CommandItem
                  key={action.id}
                  value={action.id}
                  onSelect={action.action}
                  keywords={action.keywords}
                  disabled={isReadOnly && action.id.startsWith("preset-settings")}
                >
                  {action.icon}
                  <span className="ml-2">{action.label}</span>
                  <Play className="w-3 h-3 ml-auto text-muted-foreground" />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Scope Switching */}
        <CommandSeparator />
        <CommandGroup heading={t("settingsManager.command.scopes")}>
          {actions.scopes.map((action) => (
            <CommandItem
              key={action.id}
              value={action.id}
              onSelect={action.action}
              keywords={action.keywords}
            >
              {action.icon}
              <span className="ml-2">{action.label}</span>
              {action.shortcut && (
                <CommandShortcut>{action.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};

export default SettingsCommandPalette;
