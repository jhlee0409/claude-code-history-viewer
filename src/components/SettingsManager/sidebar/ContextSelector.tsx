/**
 * ContextSelector Component
 *
 * Simplified context-based scope selection that hides complexity.
 * Users select WHERE (project or user-wide), not raw scope names.
 *
 * Mental Model:
 * - "This project" → Project or Local scope (with share/private toggle)
 * - "User-wide" → User scope (global defaults)
 * - Managed → Shown as locked indicators on affected fields
 */

import * as React from "react";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
  User,
  FolderOpen,
  Clock,
  Folder,
  Globe,
  Lock,
  AlertTriangle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { detectHomeDir, formatDisplayPath } from "@/utils/pathUtils";
import type { SettingsScope, ClaudeProject } from "@/types";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { useAppStore } from "@/store/useAppStore";

// ============================================================================
// Types
// ============================================================================

interface ContextSelectorProps {
  availableScopes: Record<SettingsScope, boolean>;
}

type ContextMode = "project" | "user";

interface RecentProject {
  path: string;
  name: string;
  lastUsed: number;
}

// ============================================================================
// Local Storage for Recent Projects
// ============================================================================

const RECENT_PROJECTS_KEY = "settings-manager-recent-projects";
const MAX_RECENT_PROJECTS = 5;

function getRecentProjects(): RecentProject[] {
  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as RecentProject[];
  } catch {
    return [];
  }
}

function addRecentProject(path: string, name: string): void {
  const recent = getRecentProjects().filter((p) => p.path !== path);
  recent.unshift({ path, name, lastUsed: Date.now() });
  try {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify(recent.slice(0, MAX_RECENT_PROJECTS))
    );
  } catch (error) {
    console.warn("Failed to persist recent projects:", error);
  }
}

// ============================================================================
// Component
// ============================================================================

export const ContextSelector: React.FC<ContextSelectorProps> = React.memo(
  ({ availableScopes }) => {
    const { t } = useTranslation();
    const {
      activeScope,
      setActiveScope,
      projectPath,
      setProjectPath,
      hasUnsavedChanges,
      setPendingSettings,
    } = useSettingsManager();

    // UI State
    const [isUnsavedDialogOpen, setIsUnsavedDialogOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(
      null
    );

    // Share/Private toggle (maps to project vs local scope)
    const [isPrivate, setIsPrivate] = useState(activeScope === "local");

    // Projects from app store
    const projects = useAppStore((state) => state.projects);

    // Recent projects
    const [recentProjects, setRecentProjects] = useState<RecentProject[]>(
      getRecentProjects
    );

    // Derive context mode from active scope
    const contextMode: ContextMode = useMemo(() => {
      if (activeScope === "project" || activeScope === "local") {
        return "project";
      }
      return "user";
    }, [activeScope]);

    // Home directory for path formatting
    const homeDir = useMemo(
      () => detectHomeDir(projects.map((p) => p.actual_path)),
      [projects]
    );

    // Current project name (handle both POSIX and Windows path separators)
    const currentProjectName = useMemo(() => {
      if (!projectPath) return null;
      return projectPath.split(/[\\/]/).pop() ?? null;
    }, [projectPath]);

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

      return Array.from(groups.entries())
        .map(([path, projs]) => ({
          path,
          name: formatDisplayPath(path, homeDir),
          projects: projs.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    }, [projects, homeDir]);

    // Filter recent projects to only show valid ones
    const validRecentProjects = useMemo(() => {
      const projectPaths = new Set(projects.map((p) => p.actual_path));
      return recentProjects.filter((r) => projectPaths.has(r.path));
    }, [recentProjects, projects]);

    // ========================================================================
    // Handlers
    // ========================================================================

    // Wrap action with unsaved changes check
    const withUnsavedCheck = useCallback(
      (action: () => void) => {
        if (hasUnsavedChanges) {
          setPendingAction(() => action);
          setIsUnsavedDialogOpen(true);
        } else {
          action();
        }
      },
      [hasUnsavedChanges]
    );

    // Confirm discarding unsaved changes
    const confirmDiscard = useCallback(() => {
      setPendingSettings(null);
      if (pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
      setIsUnsavedDialogOpen(false);
    }, [pendingAction, setPendingSettings]);

    // Cancel action
    const cancelAction = useCallback(() => {
      setPendingAction(null);
      setIsUnsavedDialogOpen(false);
    }, []);

    // Handle select value change
    const handleSelectChange = useCallback(
      (value: string) => {
        if (value === "__user_wide__") {
          // Switch to user-wide context
          withUnsavedCheck(() => {
            setActiveScope("user");
            setProjectPath(undefined);
          });
        } else {
          // Select a project
          const project = projects.find((p) => p.actual_path === value);
          if (!project) return;

          const action = () => {
            // Update recent projects
            addRecentProject(project.actual_path, project.name);
            setRecentProjects(getRecentProjects());

            // Set path and scope - loadSettings will be triggered by useEffect
            setProjectPath(project.actual_path);
            setActiveScope(isPrivate ? "local" : "project");
          };

          withUnsavedCheck(action);
        }
      },
      [
        projects,
        withUnsavedCheck,
        setProjectPath,
        setActiveScope,
        isPrivate,
      ]
    );

    // Toggle private/shared
    const togglePrivate = useCallback(
      (checked: boolean) => {
        if (projectPath) {
          // If we have a project, wrap the state change in unsaved check
          withUnsavedCheck(() => {
            setIsPrivate(checked);
            setActiveScope(checked ? "local" : "project");
          });
        } else {
          // No project selected, just update local toggle state
          setIsPrivate(checked);
        }
      },
      [projectPath, withUnsavedCheck, setActiveScope]
    );

    // Clear project
    const clearProject = useCallback(() => {
      withUnsavedCheck(() => {
        setProjectPath(undefined);
        setActiveScope("user");
      });
    }, [withUnsavedCheck, setProjectPath, setActiveScope]);

    // Sync isPrivate when activeScope changes externally
    React.useEffect(() => {
      setIsPrivate(activeScope === "local");
    }, [activeScope]);

    // Current select value
    const selectValue = useMemo(() => {
      if (contextMode === "user") return "__user_wide__";
      return projectPath ?? "";
    }, [contextMode, projectPath]);

    // ========================================================================
    // Render
    // ========================================================================

    return (
      <>
        <div className="space-y-3">
          {/* Context Select Dropdown */}
          <Select value={selectValue} onValueChange={handleSelectChange}>
            <SelectTrigger
              className={cn(
                "w-full h-10",
                "border-accent/30 hover:border-accent",
                "transition-colors duration-150"
              )}
            >
              <SelectValue>
                <div className="flex items-center gap-2">
                  {contextMode === "project" && projectPath ? (
                    <>
                      <FolderOpen className="w-4 h-4 text-accent" />
                      <span className="truncate">{currentProjectName}</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {t("settings.context.userWide")}
                      </span>
                    </>
                  )}
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[350px]">
              {/* Recent Projects */}
              {validRecentProjects.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="flex items-center gap-1.5 text-xs">
                    <Clock className="w-3 h-3" />
                    {t("settingsManager.context.recent")}
                  </SelectLabel>
                  {validRecentProjects.map((recent) => (
                    <SelectItem key={recent.path} value={recent.path}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-3.5 h-3.5 text-accent" />
                        <span className="truncate">{recent.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}

              {/* All Projects by Directory */}
              {groupedProjects.map((group) => (
                <SelectGroup key={group.path}>
                  <SelectLabel className="flex items-center gap-1.5 text-xs bg-muted/50 -mx-1 px-2 py-1">
                    <Folder className="w-3 h-3 text-amber-500" />
                    {group.name}
                  </SelectLabel>
                  {group.projects.map((project) => (
                    <SelectItem
                      key={project.actual_path}
                      value={project.actual_path}
                    >
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="truncate">{project.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}

              {/* User-wide option */}
              <SelectGroup>
                <SelectLabel className="text-xs border-t mt-1 pt-1">
                  {t("settingsManager.context.globalSettings")}
                </SelectLabel>
                <SelectItem value="__user_wide__">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{t("settings.context.userWide")}</span>
                  </div>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          {/* Project Context Options */}
          {contextMode === "project" && projectPath && (
            <div className="space-y-2 px-1">
              {/* Share/Private Toggle */}
              <div className="flex items-center justify-between gap-2 py-1.5">
                <Label
                  htmlFor="private-toggle"
                  className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1.5"
                >
                  {isPrivate ? (
                    <>
                      <Lock className="w-3 h-3" />
                      {t("settingsManager.context.keepPrivate")}
                    </>
                  ) : (
                    <>
                      <User className="w-3 h-3" />
                      {t("settingsManager.context.shareWithTeam")}
                    </>
                  )}
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Switch
                        id="private-toggle"
                        checked={isPrivate}
                        onCheckedChange={togglePrivate}
                        className="scale-75"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p className="text-xs">
                      {isPrivate
                        ? t("settingsManager.context.privateDesc")
                        : t("settingsManager.context.sharedDesc")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Clear Project Button */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-muted-foreground hover:text-destructive justify-start px-2"
                onClick={clearProject}
              >
                <X className="w-3 h-3 mr-1.5" />
                {t("settingsManager.context.clearProject")}
              </Button>
            </div>
          )}

          {/* User-wide Info */}
          {contextMode === "user" && (
            <div className="space-y-2 px-1">
              <p className="text-[10px] text-muted-foreground/70 leading-tight">
                {t("settings.context.userWideDesc")}
              </p>
            </div>
          )}

          {/* Managed Scope Indicator (if managed settings exist) */}
          {availableScopes.managed && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-warning/10 border border-warning/20">
              <Lock className="w-3 h-3 text-warning shrink-0" />
              <span className="text-[10px] text-warning">
                {t("settingsManager.context.managedActive")}
              </span>
            </div>
          )}
        </div>

        {/* Unsaved Changes Dialog */}
        <Dialog open={isUnsavedDialogOpen} onOpenChange={setIsUnsavedDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                {t("settingsManager.unsavedChanges.title")}
              </DialogTitle>
              <DialogDescription>
                {t("settingsManager.unsavedChanges.description")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={cancelAction}
                className="flex-1"
              >
                {t("settingsManager.unsavedChanges.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDiscard}
                className="flex-1"
              >
                {t("settingsManager.unsavedChanges.discard")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

ContextSelector.displayName = "ContextSelector";
