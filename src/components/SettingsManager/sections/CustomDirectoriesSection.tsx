/**
 * CustomDirectoriesSection Component
 *
 * Settings section for managing additional Claude configuration directories.
 * Users can add/remove custom paths (e.g., ~/.claude-personal) with labels.
 */

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Trash2,
  Pencil,
  Check,
  X,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isTauri } from "@/utils/platform";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { CustomClaudePath } from "@/types";

/** Normalize path: trim whitespace and remove trailing slashes */
function normalizePath(p: string): string {
  return p.trim().replace(/[\\/]+$/, "");
}

// ============================================================================
// Types
// ============================================================================

interface CustomDirectoriesSectionProps {
  isExpanded: boolean;
  onToggle: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

export function CustomDirectoriesSection({
  isExpanded,
  onToggle,
}: CustomDirectoriesSectionProps) {
  const { t } = useTranslation();
  const {
    userMetadata,
    addCustomClaudePath,
    removeCustomClaudePath,
    updateCustomClaudePathLabel,
    claudePath,
  } = useAppStore();

  const customPaths = userMetadata?.settings?.customClaudePaths ?? [];

  const [isAdding, setIsAdding] = React.useState(false);
  const [newPath, setNewPath] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [editingPath, setEditingPath] = React.useState<string | null>(null);
  const [editLabel, setEditLabel] = React.useState("");

  const pathInputId = React.useId();
  const labelInputId = React.useId();
  const editLabelInputId = React.useId();

  const handleSelectFolder = async () => {
    try {
      if (isTauri()) {
        const dialogModule = await import("@tauri-apps/plugin-dialog");
        const selected = await dialogModule.open({
          directory: true,
          multiple: false,
          title: t("settings.customDirectories.addDirectory"),
        });
        if (selected && typeof selected === "string") {
          setNewPath(selected);
          setAddError(null);
        }
      }
    } catch (err) {
      console.error("Folder selection failed:", err);
    }
  };

  const handleAdd = async () => {
    if (!newPath.trim()) return;

    const normalizedPath = normalizePath(newPath);

    // Check duplicate (normalize stored paths too for comparison)
    if (
      customPaths.some((cp) => normalizePath(cp.path) === normalizedPath) ||
      normalizePath(claudePath ?? "") === normalizedPath
    ) {
      setAddError(t("settings.customDirectories.duplicatePath"));
      return;
    }

    // Validate path: must be absolute, contain projects/, pass symlink checks
    try {
      const isValid = await api<boolean>("validate_custom_claude_dir", {
        path: normalizedPath,
      });
      if (!isValid) {
        setAddError(t("settings.customDirectories.invalidPath"));
        return;
      }
    } catch {
      setAddError(t("settings.customDirectories.invalidPath"));
      return;
    }

    try {
      await addCustomClaudePath(normalizedPath, newLabel.trim() || undefined);
      setNewPath("");
      setNewLabel("");
      setIsAdding(false);
      setAddError(null);
      // Auto-rescan to show projects from the new directory
      await useAppStore.getState().scanProjects();
    } catch (err) {
      setAddError(String(err));
    }
  };

  const handleRemove = async (path: string) => {
    if (!window.confirm(t("settings.customDirectories.removeConfirm"))) return;
    try {
      await removeCustomClaudePath(path);
      // Auto-rescan to remove projects from the deleted directory
      await useAppStore.getState().scanProjects();
    } catch (err) {
      setAddError(String(err));
    }
  };

  const handleStartEdit = (cp: CustomClaudePath) => {
    setEditingPath(cp.path);
    setEditLabel(cp.label ?? "");
  };

  const handleSaveEdit = async () => {
    if (editingPath == null) return;
    try {
      await updateCustomClaudePathLabel(editingPath, editLabel.trim());
      setEditingPath(null);
      setEditLabel("");
      // Rescan to update ProjectTree badges
      await useAppStore.getState().scanProjects();
    } catch (err) {
      setAddError(String(err));
    }
  };

  const handleCancelEdit = () => {
    setEditingPath(null);
    setEditLabel("");
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors">
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{t("settings.customDirectories")}</span>
        {customPaths.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {customPaths.length}
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.customDirectories.description")}
          </p>

          {/* Default path */}
          {claudePath && (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm">
              <span className="truncate flex-1 font-mono text-xs">
                {claudePath}
              </span>
              <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                {t("settings.customDirectories.default")}
              </span>
            </div>
          )}

          {/* Custom paths list */}
          {customPaths.map((cp) => (
            <div
              key={cp.path}
              className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="truncate font-mono text-xs">{cp.path}</div>
                {editingPath === cp.path ? (
                  <div className="mt-1 flex items-center gap-1">
                    <Label htmlFor={editLabelInputId} className="sr-only">
                      {t("settings.customDirectories.label")}
                    </Label>
                    <Input
                      id={editLabelInputId}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder={t(
                        "settings.customDirectories.labelPlaceholder"
                      )}
                      className="h-6 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleSaveEdit}
                      aria-label={t("common.save")}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={handleCancelEdit}
                      aria-label={t("common.cancel")}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  cp.label && (
                    <span className="text-xs text-muted-foreground">
                      {cp.label}
                    </span>
                  )
                )}
              </div>
              {editingPath !== cp.path && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleStartEdit(cp)}
                    aria-label={t("settings.customDirectories.label")}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => handleRemove(cp.path)}
                    aria-label={t("settings.customDirectories.remove")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          ))}

          {customPaths.length === 0 && !isAdding && (
            <p className="text-xs text-muted-foreground italic">
              {t("settings.customDirectories.empty")}
            </p>
          )}

          {/* Error display */}
          {addError && (
            <p className="text-xs text-destructive">{addError}</p>
          )}

          {/* Add form */}
          {isAdding ? (
            <div
              className={cn(
                "space-y-2 rounded-md border border-border p-3",
                addError && "border-destructive/50"
              )}
            >
              <div className="space-y-1">
                <Label htmlFor={pathInputId} className="text-xs">
                  {t("settings.customDirectories.path")}
                </Label>
                <div className="flex gap-1">
                  <Input
                    id={pathInputId}
                    value={newPath}
                    onChange={(e) => {
                      setNewPath(e.target.value);
                      setAddError(null);
                    }}
                    placeholder={t(
                      "settings.customDirectories.pathPlaceholder"
                    )}
                    className="h-8 text-xs font-mono"
                  />
                  {isTauri() && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={handleSelectFolder}
                      aria-label={t("settings.customDirectories.addDirectory")}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor={labelInputId} className="text-xs">
                  {t("settings.customDirectories.label")}
                </Label>
                <Input
                  id={labelInputId}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t(
                    "settings.customDirectories.labelPlaceholder"
                  )}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setIsAdding(false);
                    setNewPath("");
                    setNewLabel("");
                    setAddError(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleAdd}
                  disabled={!newPath.trim()}
                >
                  {t("settings.customDirectories.addDirectory")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={() => setIsAdding(true)}
            >
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
              {t("settings.customDirectories.addDirectory")}
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
