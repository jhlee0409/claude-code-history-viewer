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
          {/* Scope Status Card */}
          <div
            className={cn(
              "relative overflow-hidden rounded-lg border-2 transition-all duration-300",
              activeScope === "user" &&
                "bg-blue-500/10 border-blue-500/40 hover:border-blue-500/60",
              activeScope === "project" &&
                "bg-green-500/10 border-green-500/40 hover:border-green-500/60",
              activeScope === "local" &&
                "bg-amber-500/10 border-amber-500/40 hover:border-amber-500/60",
              activeScope === "managed" &&
                "bg-red-500/10 border-red-500/40 hover:border-red-500/60"
            )}
          >
            <div className="p-3 space-y-2">
              {/* Header: Icon + Scope label + Badge */}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "p-1.5 rounded-md",
                    activeScope === "user" && "bg-blue-500/20",
                    activeScope === "project" && "bg-green-500/20",
                    activeScope === "local" && "bg-amber-500/20",
                    activeScope === "managed" && "bg-red-500/20"
                  )}
                >
                  {activeScope === "user" && <Globe className="w-4 h-4 text-blue-400" />}
                  {activeScope === "project" && <FolderOpen className="w-4 h-4 text-green-400" />}
                  {activeScope === "local" && <Lock className="w-4 h-4 text-amber-400" />}
                  {activeScope === "managed" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium opacity-60 uppercase tracking-wider">
                    {activeScope === "user" && t("settingsManager.scope.user")}
                    {activeScope === "project" && t("settingsManager.scope.project")}
                    {activeScope === "local" && t("settingsManager.scope.local")}
                    {activeScope === "managed" && t("settingsManager.scope.managed")}
                  </div>
                  {projectPath && (
                    <div className="text-sm font-semibold truncate mt-0.5">
                      {currentProjectName}
                    </div>
                  )}
                </div>

                {/* Scope badge */}
                <div
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0",
                    activeScope === "user" && "bg-blue-500/20 text-blue-300",
                    activeScope === "project" && "bg-green-500/20 text-green-300",
                    activeScope === "local" && "bg-amber-500/20 text-amber-300",
                    activeScope === "managed" && "bg-red-500/20 text-red-300"
                  )}
                >
                  {activeScope === "user" && t("settingsManager.scope.badge.global")}
                  {activeScope === "project" && t("settingsManager.scope.badge.shared")}
                  {activeScope === "local" && t("settingsManager.scope.badge.private")}
                  {activeScope === "managed" && t("settingsManager.scope.badge.locked")}
                </div>
              </div>

              {/* Description */}
              <p className="text-[10px] leading-relaxed opacity-50 pl-9">
                {activeScope === "user" && t("settings.context.userWideDesc")}
                {activeScope === "project" && t("settingsManager.context.sharedDesc")}
                {activeScope === "local" && t("settingsManager.context.privateDesc")}
                {activeScope === "managed" && t("settingsManager.context.managedActive")}
              </p>
            </div>
          </div>

          {/* Project Selector Dropdown */}
          <Select value={selectValue} onValueChange={handleSelectChange}>
            <SelectTrigger
              className={cn(
                "w-full h-9 text-sm",
                "border-border/50 hover:border-border",
                "bg-background/50",
                "transition-all duration-150"
              )}
            >
              <SelectValue>
                <div className="flex items-center gap-2">
                  {contextMode === "project" && projectPath ? (
                    <>
                      <FolderOpen className="w-3.5 h-3.5 opacity-70" />
                      <span className="truncate">{currentProjectName}</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5 opacity-50" />
                      <span className="opacity-60">
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

          {/* Project Context Controls */}
          {contextMode === "project" && projectPath && (
            <div className="space-y-2 pt-1">
              {/* Share/Private Toggle Bar */}
              <div
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-all duration-200",
                  isPrivate
                    ? "bg-amber-500/5 border-amber-500/20"
                    : "bg-green-500/5 border-green-500/20"
                )}
              >
                <Label
                  htmlFor="private-toggle"
                  className="text-xs font-medium cursor-pointer flex items-center gap-2 flex-1"
                >
                  {isPrivate ? (
                    <>
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-amber-300">
                        {t("settingsManager.context.keepPrivate")}
                      </span>
                    </>
                  ) : (
                    <>
                      <User className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-green-300">
                        {t("settingsManager.context.shareWithTeam")}
                      </span>
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
                        className="scale-90"
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
                className="w-full h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 justify-center"
                onClick={clearProject}
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                {t("settingsManager.context.clearProject")}
              </Button>
            </div>
          )}

          {/* Managed Scope Warning */}
          {availableScopes.managed && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/30">
              <Lock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <span className="text-xs font-semibold text-warning">
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
