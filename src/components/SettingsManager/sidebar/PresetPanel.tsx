/**
 * PresetPanel Component
 *
 * Unified preset panel that combines settings and MCP servers
 * into single presets for complete configuration backup/restore.
 *
 * Clean, simple interaction pattern:
 * - Hover shows "Apply" button
 * - Click Apply = Opens confirmation dialog
 * - Dropdown menu for Edit/Duplicate/Delete
 */

import * as React from "react";
import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  Package,
  Play,
  User,
  FolderOpen,
  FileCode,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  FileJson,
  AlertTriangle,
  Loader2,
  Check,
  Server,
  Shield,
  Cpu,
  Zap,
} from "lucide-react";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { useUnifiedPresets } from "@/hooks/useUnifiedPresets";
import { useAppStore } from "@/store/useAppStore";
import { detectHomeDir, formatDisplayPath } from "@/utils/pathUtils";
import type {
  ClaudeCodeSettings,
  SettingsScope,
  ClaudeProject,
  UnifiedPresetData,
  UnifiedPresetInput,
} from "@/types";
import { mergeSettings } from "@/utils/settingsMerger";

// ============================================================================
// Types
// ============================================================================

type DialogMode = "create" | "edit" | "apply" | "delete" | "duplicate";

// ============================================================================
// Preset Item Component
// ============================================================================

interface PresetItemProps {
  preset: UnifiedPresetData;
  isReadOnly: boolean;
  onApplyHere: () => void;
  onApplyTo: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const PresetItem: React.FC<PresetItemProps> = React.memo(
  ({ preset, isReadOnly, onApplyHere, onApplyTo, onEdit, onDuplicate, onDelete }) => {
    const { t } = useTranslation();
    const { summary } = preset;

    return (
      <TooltipProvider delayDuration={400}>
        <div className="group relative rounded-lg border border-border/50 hover:border-border bg-card/50 hover:bg-muted/40 transition-all duration-150">
          {/* Top row: name + badges */}
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
            <Package className="w-3.5 h-3.5 text-indigo-500/70 shrink-0" />
            <span className="text-xs font-semibold truncate flex-1">{preset.name}</span>

            {/* Action icons - visible on hover */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onApplyHere}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-green-600 hover:text-green-700 hover:bg-green-500/10 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t("settingsManager.presets.applyHere")}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onApplyTo}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label={t("settingsManager.presets.applyTo")}
                  >
                    <Play className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t("settingsManager.presets.applyTo")}
                </TooltipContent>
              </Tooltip>

              {!isReadOnly && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      {t("common.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onDuplicate}>
                      <Copy className="w-3.5 h-3.5 mr-2" />
                      {t("common.duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Row 2: badges */}
          {(summary.model || summary.mcpServerCount > 0) && (
            <div className="px-3 flex items-center gap-1.5">
              {summary.model && (
                <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-indigo-400 whitespace-nowrap">
                  {summary.model}
                </span>
              )}
              {summary.mcpServerCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 whitespace-nowrap">
                  <Server className="w-2.5 h-2.5 shrink-0" />
                  {t("settingsManager.presets.badge.mcpCount", { count: summary.mcpServerCount })}
                </span>
              )}
            </div>
          )}

          {/* Row 3: description */}
          {preset.description && (
            <div className="px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground/60 truncate block">
                {preset.description}
              </span>
            </div>
          )}

          {/* Bottom padding when no description */}
          {!preset.description && <div className="pb-1.5" />}
        </div>
      </TooltipProvider>
    );
  }
);

PresetItem.displayName = "PresetItem";

// ============================================================================
// Main Component
// ============================================================================

export const PresetPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    allSettings,
    saveSettings,
    isReadOnly,
    mcpServers,
    saveMCPServers,
    activeScope,
    projectPath,
  } = useSettingsManager();

  const {
    presets,
    savePreset,
    deletePreset,
    duplicatePreset,
  } = useUnifiedPresets();

  // Dialog state
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [selectedPreset, setSelectedPreset] =
    useState<UnifiedPresetData | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formNameError, setFormNameError] = useState<string | null>(null);
  const [formJsonText, setFormJsonText] = useState("");
  const [formJsonError, setFormJsonError] = useState<string | null>(null);
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);

  // Loading/success state
  const [isApplying, setIsApplying] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Ref for cleanup of setTimeout to prevent memory leaks
  const closeDialogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeDialogTimeoutRef.current) {
        clearTimeout(closeDialogTimeoutRef.current);
      }
    };
  }, []);

  // Apply preset state
  const [targetScope, setTargetScope] = useState<SettingsScope>(activeScope);
  const [targetProject, setTargetProject] = useState<string | undefined>(
    projectPath
  );

  // Get projects from app store
  const projects = useAppStore((state) => state.projects);

  // Check if target scope needs project selection
  const needsProject = targetScope === "project" || targetScope === "local";

  // Available scopes
  const availableScopes: {
    value: SettingsScope;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "user",
      label: t("settingsManager.scope.user"),
      icon: <User className="w-4 h-4" />,
    },
    {
      value: "project",
      label: t("settingsManager.scope.project"),
      icon: <FolderOpen className="w-4 h-4" />,
    },
    {
      value: "local",
      label: t("settingsManager.scope.local"),
      icon: <FileCode className="w-4 h-4" />,
    },
  ];

  // Group projects by directory (handle both POSIX and Windows path separators)
  const groupedProjects = useMemo(() => {
    const groups = new Map<string, ClaudeProject[]>();
    projects.forEach((project) => {
      const parts = project.actual_path.split(/[\\/]/);
      parts.pop();
      const parentPath = parts.join("/") || "/";
      const existing = groups.get(parentPath) ?? [];
      existing.push(project);
      groups.set(parentPath, existing);
    });

    const homeDir = detectHomeDir(projects.map((p) => p.actual_path));

    return Array.from(groups.entries())
      .map(([path, projs]) => ({
        path,
        name: formatDisplayPath(path, homeDir),
        projects: projs.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [projects]);

  // Get current MCP servers for the active scope
  const getCurrentMCPServers = () => {
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
  };

  const currentMCPServers = getCurrentMCPServers();

  // Compute effective settings (merged from all scopes) for preset saving
  const effectiveSettings = useMemo(() => {
    if (!allSettings) return {};
    const merged = mergeSettings(allSettings);
    return merged.effective;
  }, [allSettings]);

  // Check if we have content to save
  const hasContent =
    Object.keys(effectiveSettings).length > 0 ||
    Object.keys(currentMCPServers).length > 0;

  // ============================================================================
  // Dialog Handlers
  // ============================================================================

  const openDialog = (mode: DialogMode, preset?: UnifiedPresetData) => {
    setDialogMode(mode);
    setSelectedPreset(preset ?? null);
    setIsJsonExpanded(false);
    setFormNameError(null);

    if (mode === "create") {
      setFormName("");
      setFormDescription("");
    } else if (mode === "edit" && preset) {
      setFormName(preset.name);
      setFormDescription(preset.description ?? "");
      try {
        const jsonObj = {
          settings: JSON.parse(preset.settings || "{}"),
          mcpServers: JSON.parse(preset.mcpServers || "{}"),
        };
        setFormJsonText(JSON.stringify(jsonObj, null, 2));
        setFormJsonError(null);
      } catch {
        setFormJsonText(preset.settings || "{}");
        setFormJsonError(null);
      }
    } else if (mode === "duplicate" && preset) {
      setFormName(`${preset.name} (Copy)`);
      setFormDescription(preset.description ?? "");
    } else if (mode === "apply") {
      setTargetScope(activeScope === "managed" ? "user" : activeScope);
      setTargetProject(projectPath);
      setIsApplying(false);
      setApplySuccess(false);
      setApplyError(null);
    }
  };

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedPreset(null);
    setFormName("");
    setFormDescription("");
    setFormNameError(null);
    setFormJsonText("");
    setFormJsonError(null);
    setIsJsonExpanded(false);
    setIsApplying(false);
    setApplySuccess(false);
    setApplyError(null);
  };

  // ============================================================================
  // Validation
  // ============================================================================

  const validatePresetName = (name: string, excludeId?: string): boolean => {
    const trimmedName = name.trim();
    if (!trimmedName) return true;

    const isDuplicate = presets.some(
      (p) =>
        p.name.toLowerCase() === trimmedName.toLowerCase() && p.id !== excludeId
    );

    if (isDuplicate) {
      setFormNameError(t("settingsManager.presets.duplicateName"));
      return false;
    }

    setFormNameError(null);
    return true;
  };

  // ============================================================================
  // Actions
  // ============================================================================

  const handleSavePreset = async () => {
    if (!formName.trim()) return;
    if (!validatePresetName(formName)) return;

    const input: UnifiedPresetInput = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      settings: JSON.stringify(effectiveSettings),
      mcpServers: JSON.stringify(currentMCPServers),
    };

    try {
      await savePreset(input);
      closeDialog();
    } catch (err) {
      console.error("Failed to save preset:", err);
      setApplyError(t("error.savePresetFailed", { detail: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleUpdatePreset = async () => {
    if (!formName.trim() || !selectedPreset) return;
    if (!validatePresetName(formName, selectedPreset.id)) return;

    let settingsJson = selectedPreset.settings;
    let mcpServersJson = selectedPreset.mcpServers;

    if (formJsonText.trim()) {
      try {
        const parsed = JSON.parse(formJsonText);
        settingsJson = JSON.stringify(parsed.settings ?? {});
        mcpServersJson = JSON.stringify(parsed.mcpServers ?? {});
      } catch {
        setFormJsonError(t("settingsManager.presets.invalidJson"));
        return;
      }
    }

    const input: UnifiedPresetInput = {
      id: selectedPreset.id,
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      settings: settingsJson,
      mcpServers: mcpServersJson,
    };

    try {
      await savePreset(input);
      closeDialog();
    } catch (err) {
      console.error("Failed to update preset:", err);
      setApplyError(t("error.updatePresetFailed", { detail: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleDuplicatePreset = async () => {
    if (!formName.trim() || !selectedPreset) return;
    if (!validatePresetName(formName)) return;

    try {
      await duplicatePreset(selectedPreset.id, formName.trim());
      closeDialog();
    } catch (err) {
      console.error("Failed to duplicate preset:", err);
      setApplyError(t("error.duplicatePresetFailed", { detail: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleDeletePreset = async () => {
    if (!selectedPreset) return;

    try {
      await deletePreset(selectedPreset.id);
      closeDialog();
    } catch (err) {
      console.error("Failed to delete preset:", err);
      setApplyError(t("error.deletePresetFailed", { detail: err instanceof Error ? err.message : String(err) }));
    }
  };

  // Apply preset directly to current scope without dialog
  const handleApplyHere = async (preset: UnifiedPresetData) => {
    // 1. Parse both settings and MCP servers FIRST (no side effects)
    let settings: ClaudeCodeSettings;
    let servers: Record<string, unknown>;

    try {
      settings = JSON.parse(preset.settings) as ClaudeCodeSettings;
    } catch (parseError) {
      const errorMsg = `Failed to parse preset settings for "${preset.name}": ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      console.error(errorMsg);
      setApplyError(t("error.invalidPresetSettings") || errorMsg);
      return;
    }

    try {
      servers = JSON.parse(preset.mcpServers) as Record<string, unknown>;
    } catch (parseError) {
      const errorMsg = `Failed to parse preset MCP servers for "${preset.name}": ${parseError instanceof Error ? parseError.message : String(parseError)}`;
      console.error(errorMsg);
      setApplyError(t("error.invalidPresetMcpServers") || errorMsg);
      return;
    }

    // 2. Now apply both (safe to proceed since parsing succeeded)
    try {
      const scope = activeScope === "managed" ? "user" : activeScope;

      // Apply settings
      if (Object.keys(settings).length > 0) {
        await saveSettings(settings, scope, projectPath);
      }

      // Apply MCP servers
      if (Object.keys(servers).length > 0) {
        const mcpSource =
          activeScope === "user" || activeScope === "managed"
            ? "user_claude_json"
            : activeScope === "project"
              ? "project_mcp"
              : "local_claude_json";
        await saveMCPServers(mcpSource, servers as Parameters<typeof saveMCPServers>[1], projectPath);
      }
    } catch (e) {
      const errorMsg = `Failed to apply preset "${preset.name}": ${e instanceof Error ? e.message : String(e)}`;
      console.error(errorMsg);
      setApplyError(t("error.applyPresetFailed", { detail: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleApplyPreset = async () => {
    if (!selectedPreset) return;
    if (needsProject && !targetProject) return;

    setIsApplying(true);
    try {
      // Parse all data BEFORE any side effects (transaction pattern)
      let settings: ClaudeCodeSettings;
      let serversRaw: Record<string, unknown>;

      try {
        settings = JSON.parse(selectedPreset.settings) as ClaudeCodeSettings;
      } catch (parseError) {
        console.error("Failed to parse preset settings:", parseError);
        setApplyError(t("error.invalidPresetSettings") || "Failed to parse preset settings. The preset data may be corrupted.");
        setIsApplying(false);
        return;
      }

      try {
        serversRaw = JSON.parse(selectedPreset.mcpServers) as Record<string, unknown>;
      } catch (parseError) {
        console.error("Failed to parse preset MCP servers:", parseError);
        setApplyError(t("error.invalidPresetMcpServers") || "Failed to parse preset MCP servers. The preset data may be corrupted.");
        setIsApplying(false);
        return;
      }

      // All parsing succeeded — now apply side effects
      if (Object.keys(settings).length > 0) {
        await saveSettings(settings, targetScope, targetProject);
      }

      if (Object.keys(serversRaw).length > 0) {
        const mcpSource =
          targetScope === "user"
            ? "user_claude_json"
            : targetScope === "project"
              ? "project_mcp"
              : targetScope === "local"
                ? "local_claude_json"
                : "user_claude_json";

        // Type assertion is safe here since we're restoring from a previously saved preset
        await saveMCPServers(mcpSource, serversRaw as Parameters<typeof saveMCPServers>[1], targetProject);
      }

      setApplySuccess(true);
      // Clear any existing timeout before setting a new one
      if (closeDialogTimeoutRef.current) {
        clearTimeout(closeDialogTimeoutRef.current);
      }
      closeDialogTimeoutRef.current = setTimeout(() => {
        closeDialog();
      }, 1000);
    } catch (e) {
      const errorMsg = `Failed to apply preset "${selectedPreset.name}": ${e instanceof Error ? e.message : String(e)}`;
      console.error(errorMsg);
      setApplyError(t("error.applyPresetFailed", { detail: e instanceof Error ? e.message : String(e) }));
      setIsApplying(false);
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="space-y-2">
      {/* Preset List */}
      <div className="space-y-1">
        {presets.map((preset) => (
          <PresetItem
            key={preset.id}
            preset={preset}
            isReadOnly={isReadOnly}
            onApplyHere={() => handleApplyHere(preset)}
            onApplyTo={() => openDialog("apply", preset)}
            onEdit={() => openDialog("edit", preset)}
            onDuplicate={() => openDialog("duplicate", preset)}
            onDelete={() => openDialog("delete", preset)}
          />
        ))}

        {/* Empty state */}
        {presets.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            {t("settingsManager.presets.empty")}
          </p>
        )}

        {/* Save button */}
        {!isReadOnly && hasContent && (
          <div className="pt-2 border-t border-border/30 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-8 text-xs text-muted-foreground hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors duration-150"
              onClick={() => openDialog("create")}
            >
              <Package className="w-3.5 h-3.5 mr-2" />
              {t("settingsManager.presets.saveCurrentConfig")}
            </Button>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* Create/Edit/Duplicate Dialog */}
      {/* ================================================================== */}
      <Dialog
        open={
          dialogMode === "create" ||
          dialogMode === "edit" ||
          dialogMode === "duplicate"
        }
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className={dialogMode === "edit" ? "sm:max-w-3xl max-h-[85vh] flex flex-col" : "max-w-lg max-h-[85vh] flex flex-col"}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              {dialogMode === "create"
                ? t("settingsManager.presets.createTitle")
                : dialogMode === "edit"
                  ? t("settingsManager.presets.editTitle")
                  : t("common.duplicate")}
            </DialogTitle>
            {dialogMode === "create" && (
              <DialogDescription>
                {t("settingsManager.presets.createDesc")}
              </DialogDescription>
            )}
          </DialogHeader>

          {dialogMode === "edit" ? (
            /* ── Edit mode: 2-column layout ── */
            <div className="flex gap-4 flex-1 min-h-0">
              {/* Left column: form fields */}
              <div className="w-48 shrink-0 space-y-4 overflow-y-auto pr-1">
                <div>
                  <Label htmlFor="preset-name">
                    {t("settingsManager.presets.name")}
                  </Label>
                  <Input
                    id="preset-name"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setFormNameError(null);
                    }}
                    onBlur={() =>
                      validatePresetName(formName, selectedPreset?.id)
                    }
                    placeholder={t("settingsManager.presets.namePlaceholder")}
                    className={`mt-1.5 ${formNameError ? "border-destructive" : ""}`}
                    autoFocus
                  />
                  {formNameError && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formNameError}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="preset-desc">
                    {t("settingsManager.presets.description")}
                  </Label>
                  <Textarea
                    id="preset-desc"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t(
                      "settingsManager.presets.descriptionPlaceholder"
                    )}
                    className="mt-1.5 resize-none"
                    rows={3}
                  />
                </div>
              </div>

              {/* Right column: JSON editor */}
              <div className="flex-1 flex flex-col min-w-0">
                <Label className="mb-1.5 flex items-center gap-2">
                  <FileJson className="w-4 h-4" />
                  JSON
                </Label>
                <Textarea
                  value={formJsonText}
                  onChange={(e) => {
                    setFormJsonText(e.target.value);
                    setFormJsonError(null);
                  }}
                  className="font-mono text-xs flex-1 min-h-[300px] resize-none"
                  spellCheck={false}
                />
                {formJsonError && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {formJsonError}
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* ── Create/Duplicate mode: single column ── */
            <div className="overflow-y-auto flex-1 min-h-0 pr-1 space-y-4">
              {/* Summary Card (only for create) */}
              {dialogMode === "create" && (
                <div className="bg-muted border rounded-lg p-3">
                  <div className="text-sm font-medium mb-2">
                    {t("settingsManager.presets.includedContent")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(effectiveSettings).length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <Cpu className="w-3 h-3 mr-1" />
                        {Object.keys(effectiveSettings).length} {t("settingsManager.presets.summary.settings")}
                      </Badge>
                    )}
                    {Object.keys(currentMCPServers).length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <Server className="w-3 h-3 mr-1" />
                        {Object.keys(currentMCPServers).length} {t("settingsManager.presets.summary.mcpServers")}
                      </Badge>
                    )}
                    {(effectiveSettings as ClaudeCodeSettings).permissions && (
                      <Badge variant="secondary" className="text-xs">
                        <Shield className="w-3 h-3 mr-1" />
                        {t("settingsManager.presets.summary.permissions")}
                      </Badge>
                    )}
                    {(effectiveSettings as ClaudeCodeSettings).hooks && (
                      <Badge variant="secondary" className="text-xs">
                        <Zap className="w-3 h-3 mr-1" />
                        {t("settingsManager.presets.summary.hooks")}
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="preset-name">
                    {t("settingsManager.presets.name")}
                  </Label>
                  <Input
                    id="preset-name"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setFormNameError(null);
                    }}
                    onBlur={() =>
                      validatePresetName(formName, selectedPreset?.id)
                    }
                    placeholder={t("settingsManager.presets.namePlaceholder")}
                    className={`mt-1.5 ${formNameError ? "border-destructive" : ""}`}
                    autoFocus
                  />
                  {formNameError && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {formNameError}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="preset-desc">
                    {t("settingsManager.presets.description")}
                  </Label>
                  <Textarea
                    id="preset-desc"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t(
                      "settingsManager.presets.descriptionPlaceholder"
                    )}
                    className="mt-1.5 resize-none"
                    rows={2}
                  />
                </div>
              </div>

              {/* JSON Preview (create only) */}
              {dialogMode === "create" && (
                <Collapsible
                  open={isJsonExpanded}
                  onOpenChange={setIsJsonExpanded}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between px-3 h-9"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <FileJson className="w-4 h-4" />
                        {t("settingsManager.presets.viewJson")}
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${isJsonExpanded ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-[150px] font-mono mt-2">
                      {JSON.stringify(
                        {
                          settings: effectiveSettings,
                          mcpServers: currentMCPServers,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={
                dialogMode === "create"
                  ? handleSavePreset
                  : dialogMode === "edit"
                    ? handleUpdatePreset
                    : handleDuplicatePreset
              }
              disabled={!formName.trim() || !!formNameError}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* Apply Dialog */}
      {/* ================================================================== */}
      <Dialog
        open={dialogMode === "apply"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settingsManager.presets.loadPresetConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settingsManager.unified.presets.applyPresetDesc", {
                name: selectedPreset?.name,
              })}
            </DialogDescription>
          </DialogHeader>

          {/* Preset Summary */}
          {selectedPreset && (
            <div className="bg-muted border rounded-lg p-3 my-2">
              <div className="text-sm font-medium mb-2">
                {t("settingsManager.presets.includedContent")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedPreset.summary.settingsCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <Cpu className="w-3 h-3 mr-1" />
                    {selectedPreset.summary.settingsCount} {t("settingsManager.presets.summary.settings")}
                  </Badge>
                )}
                {selectedPreset.summary.model && (
                  <Badge variant="secondary" className="text-xs font-mono">
                    {selectedPreset.summary.model}
                  </Badge>
                )}
                {selectedPreset.summary.mcpServerCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <Server className="w-3 h-3 mr-1" />
                    {selectedPreset.summary.mcpServerCount} {t("settingsManager.presets.summary.mcpServers")}
                  </Badge>
                )}
                {selectedPreset.summary.hasPermissions && (
                  <Badge variant="secondary" className="text-xs">
                    <Shield className="w-3 h-3 mr-1" />
                    {t("settingsManager.presets.summary.permissions")}
                  </Badge>
                )}
                {selectedPreset.summary.hasHooks && (
                  <Badge variant="secondary" className="text-xs">
                    <Zap className="w-3 h-3 mr-1" />
                    {t("settingsManager.presets.summary.hooks")}
                  </Badge>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4 py-2">
            {/* Scope Selection */}
            <div>
              <Label className="text-sm font-medium">
                {t("settingsManager.unified.presets.targetScope")}
              </Label>
              <Select
                value={targetScope}
                onValueChange={(value) => {
                  setTargetScope(value as SettingsScope);
                  if (value === "user") {
                    setTargetProject(undefined);
                  } else {
                    setTargetProject(projectPath);
                  }
                }}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableScopes.map((scope) => (
                    <SelectItem key={scope.value} value={scope.value}>
                      <div className="flex items-center gap-2">
                        {scope.icon}
                        <span>{scope.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Project Selection */}
            {needsProject && (
              <div>
                <Label className="text-sm font-medium">
                  {t("settingsManager.unified.presets.targetProject")}
                </Label>
                <Select
                  value={targetProject ?? ""}
                  onValueChange={(value) =>
                    setTargetProject(value || undefined)
                  }
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue
                      placeholder={t(
                        "settingsManager.unified.presets.selectProject"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {groupedProjects.map((group) => (
                      <SelectGroup key={group.path}>
                        <SelectLabel className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-1.5">
                          {group.name}
                        </SelectLabel>
                        {group.projects.map((proj) => (
                          <SelectItem
                            key={proj.actual_path}
                            value={proj.actual_path}
                          >
                            <div className="flex items-center gap-2">
                              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>{proj.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {applyError && (
            <p className="text-sm text-destructive px-1">{applyError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={isApplying}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleApplyPreset}
              disabled={(needsProject && !targetProject) || isApplying}
              className="min-w-[80px]"
            >
              {applySuccess ? (
                <>
                  <Check className="w-4 h-4 mr-1.5 text-green-500" />
                  {t("settingsManager.presets.applied", { name: selectedPreset?.name })}
                </>
              ) : isApplying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  {t("settingsManager.presets.applying")}
                </>
              ) : (
                t("settingsManager.presets.apply")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================== */}
      {/* Delete Confirmation Dialog */}
      {/* ================================================================== */}
      <Dialog
        open={dialogMode === "delete"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              {t("settingsManager.presets.deleteConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settingsManager.presets.deleteConfirmDesc", {
                name: selectedPreset?.name,
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeletePreset}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
