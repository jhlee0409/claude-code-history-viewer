/**
 * ScopeSwitcher Component
 *
 * Vertical list for switching between settings scopes.
 * Shows availability status for each scope.
 * Includes project selector with collapsible directory tree.
 */

import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  User,
  FolderOpen,
  FileCode,
  Shield,
  Circle,
  Plus,
  Search,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { detectHomeDir, formatDisplayPath } from "@/utils/pathUtils";
import type { SettingsScope, ClaudeProject } from "@/types";
import { useSettingsManager } from "../UnifiedSettingsManager";
import { useAppStore } from "@/store/useAppStore";

// ============================================================================
// Types
// ============================================================================

interface ScopeSwitcherProps {
  availableScopes: Record<SettingsScope, boolean>;
}

interface ScopeItemConfig {
  scope: SettingsScope;
  icon: React.ReactNode;
  descriptionKey: string;
  requiresProject?: boolean;
}

interface DirectoryGroup {
  path: string;
  name: string;
  projects: ClaudeProject[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Global scopes - do not require project context
 */
const GLOBAL_SCOPES: ScopeItemConfig[] = [
  {
    scope: "user",
    icon: <User className="w-4 h-4" />,
    descriptionKey: "settingsManager.unified.scope.user.description",
  },
  {
    scope: "managed",
    icon: <Shield className="w-4 h-4" />,
    descriptionKey: "settingsManager.unified.scope.managed.description",
  },
];

/**
 * Project scopes - require project context
 */
const PROJECT_SCOPES: ScopeItemConfig[] = [
  {
    scope: "project",
    icon: <FolderOpen className="w-4 h-4" />,
    descriptionKey: "settingsManager.unified.scope.project.description",
    requiresProject: true,
  },
  {
    scope: "local",
    icon: <FileCode className="w-4 h-4" />,
    descriptionKey: "settingsManager.unified.scope.local.description",
    requiresProject: true,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group projects by their parent directory
 */
function groupProjectsByDirectory(projects: ClaudeProject[]): DirectoryGroup[] {
  const groups = new Map<string, ClaudeProject[]>();

  projects.forEach((project) => {
    // Get parent directory path
    const parts = project.actual_path.split("/");
    parts.pop(); // Remove project name
    const parentPath = parts.join("/") || "/";

    const existing = groups.get(parentPath) ?? [];
    existing.push(project);
    groups.set(parentPath, existing);
  });

  // Detect home directory for display formatting
  const homeDir = detectHomeDir(projects.map((p) => p.actual_path));

  // Convert to array and sort
  return Array.from(groups.entries())
    .map(([path, projs]) => ({
      path,
      name: formatDisplayPath(path, homeDir),
      projects: projs.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// ============================================================================
// Component
// ============================================================================

export const ScopeSwitcher: React.FC<ScopeSwitcherProps> = React.memo(({
  availableScopes,
}) => {
  const { t } = useTranslation();
  const { activeScope, setActiveScope, projectPath, setProjectPath, loadSettings } = useSettingsManager();

  // Project selector dialog state
  const [isProjectSelectorOpen, setIsProjectSelectorOpen] = useState(false);
  const [pendingScope, setPendingScope] = useState<SettingsScope | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Get projects from global app store (already loaded at app startup)
  const projects = useAppStore((state) => state.projects);
  const isLoadingProjects = useAppStore((state) => state.isLoadingProjects);
  const claudePath = useAppStore((state) => state.claudePath);
  const scanProjects = useAppStore((state) => state.scanProjects);

  // Ensure projects are loaded when dialog opens
  React.useEffect(() => {
    if (isProjectSelectorOpen && projects.length === 0 && claudePath && !isLoadingProjects) {
      // Projects not loaded yet, trigger a scan
      if (import.meta.env.DEV) {
        console.log("[ScopeSwitcher] Dialog opened but no projects, triggering scanProjects...");
      }
      scanProjects();
    }
  }, [isProjectSelectorOpen, projects.length, claudePath, isLoadingProjects, scanProjects]);

  // Debug logging
  React.useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[ScopeSwitcher] projects:", projects.length, "isLoading:", isLoadingProjects, "claudePath:", claudePath);
    }
  }, [projects, isLoadingProjects, claudePath]);

  // Collapsed state for directory groups
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  // Filter projects by search query
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const query = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.actual_path.toLowerCase().includes(query)
    );
  }, [projects, searchQuery]);

  // Group filtered projects by directory
  const directoryGroups = useMemo(() => {
    return groupProjectsByDirectory(filteredProjects);
  }, [filteredProjects]);

  // Toggle directory collapse
  const toggleDirectory = (path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Expand all directories
  const expandAll = () => {
    setCollapsedDirs(new Set());
  };

  // Collapse all directories
  const collapseAll = () => {
    setCollapsedDirs(new Set(directoryGroups.map((g) => g.path)));
  };

  // Handle selecting a project scope (project/local) - opens selector if no project
  const handleProjectScopeClick = (scope: SettingsScope) => {
    if (!projectPath) {
      // No project selected - open selector
      setPendingScope(scope);
      setIsProjectSelectorOpen(true);
    } else {
      setActiveScope(scope);
    }
  };

  // Handle project selection
  const handleSelectProject = async (project: ClaudeProject) => {
    // Use actual_path which is the decoded filesystem path
    setProjectPath(project.actual_path);
    setIsProjectSelectorOpen(false);
    setSearchQuery("");

    // Wait for settings to reload with new project
    await loadSettings();

    // Switch to the pending scope
    if (pendingScope) {
      setActiveScope(pendingScope);
      setPendingScope(null);
    }
  };

  // Handle clear project (switch back to user scope)
  const handleClearProject = () => {
    setProjectPath(undefined);
    setActiveScope("user");
  };

  // Render a scope button
  const renderScopeButton = (
    { scope, icon, descriptionKey }: ScopeItemConfig,
    onClick: () => void
  ) => {
    const isAvailable = availableScopes[scope];
    const isActive = activeScope === scope;

    return (
      <Tooltip key={scope}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "justify-start gap-2 h-9 transition-colors duration-150",
              isActive
                ? "bg-accent/20 text-accent"
                : "text-muted-foreground hover:text-accent hover:bg-accent/10"
            )}
            onClick={onClick}
          >
            <div
              className={cn(
                "w-5 h-5 rounded-md flex items-center justify-center",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "bg-accent/10"
              )}
            >
              {icon}
            </div>
            <span className="flex-1 text-left">
              {t(`settingsManager.scope.${scope}`)}
            </span>
            <div className="flex items-center gap-1">
              {scope === "managed" && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                  RO
                </Badge>
              )}
              {isAvailable ? (
                <Circle className="w-2 h-2 fill-green-500 text-green-500" />
              ) : (
                <Plus className="w-3 h-3 text-muted-foreground" />
              )}
            </div>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <p className="font-medium">{t(`settingsManager.scope.${scope}`)}</p>
          <p className="text-xs text-muted-foreground">
            {t(descriptionKey)}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* Global Scopes Section */}
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 mb-1">
            {t("settingsManager.unified.scope.globalScopes")}
          </p>
          {GLOBAL_SCOPES.map((config) =>
            renderScopeButton(config, () => setActiveScope(config.scope))
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border/30" />

        {/* Project Scopes Section */}
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 mb-1">
            {t("settingsManager.unified.scope.projectScopes")}
          </p>

          {/* Project Selector - shows when project scopes exist */}
          <div
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-150",
              projectPath
                ? "bg-accent/10 border border-accent/20"
                : "border border-dashed border-muted-foreground/30 hover:border-accent/50 hover:bg-accent/5"
            )}
            onClick={() => {
              if (!projectPath) {
                setPendingScope("project");
                setIsProjectSelectorOpen(true);
              }
            }}
          >
            <FolderOpen className={cn(
              "w-3.5 h-3.5 shrink-0",
              projectPath ? "text-accent" : "text-muted-foreground"
            )} />
            <span className={cn(
              "text-xs truncate flex-1",
              projectPath ? "text-foreground/80" : "text-muted-foreground"
            )}>
              {projectPath
                ? projectPath.split("/").pop()
                : t("settingsManager.unified.scope.selectProject")}
            </span>
            {projectPath && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearProject();
                }}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* Project Scope Buttons - only enabled when project is selected */}
          <div className={cn(
            "space-y-0.5 transition-opacity duration-150",
            !projectPath && "opacity-50 pointer-events-none"
          )}>
            {PROJECT_SCOPES.map((config) =>
              renderScopeButton(config, () => handleProjectScopeClick(config.scope))
            )}
          </div>

          {/* Hint when no project */}
          {!projectPath && (
            <p className="text-[10px] text-muted-foreground/60 px-2 pt-1">
              {t("settingsManager.unified.scope.selectProjectHint")}
            </p>
          )}
        </div>
      </div>

      {/* Project Selector Dialog */}
      <Dialog open={isProjectSelectorOpen} onOpenChange={setIsProjectSelectorOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              {t("settingsManager.unified.projectSelector.title")}
              {import.meta.env.DEV && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  {projects.length} loaded
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {t("settingsManager.unified.projectSelector.description")}
            </DialogDescription>
          </DialogHeader>

          {/* Search + Expand/Collapse buttons */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t("settingsManager.unified.projectSelector.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    onClick={expandAll}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settingsManager.unified.projectSelector.expandAll")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    onClick={collapseAll}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settingsManager.unified.projectSelector.collapseAll")}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Project Tree */}
          <div className="flex-1 min-h-0 overflow-auto -mx-6 px-6 max-h-[55vh]">
            {isLoadingProjects ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery
                  ? t("settingsManager.unified.projectSelector.noResults")
                  : t("settingsManager.unified.projectSelector.noProjects")}
              </div>
            ) : (
              <div className="space-y-1 py-2">
                {directoryGroups.map((group) => {
                  const isCollapsed = collapsedDirs.has(group.path);

                  return (
                    <Collapsible
                      key={group.path}
                      open={!isCollapsed}
                      onOpenChange={() => toggleDirectory(group.path)}
                    >
                      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 text-foreground hover:text-accent hover:bg-accent/10 rounded-md text-sm transition-colors duration-150">
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                        <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="font-medium truncate flex-1 text-left">
                          {group.name}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          {group.projects.length}
                        </Badge>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="ml-6 border-l pl-2 space-y-0.5">
                          {group.projects.map((project) => (
                            <Button
                              key={project.actual_path}
                              variant="ghost"
                              className="w-full justify-start h-auto py-1.5 px-2 text-sm text-foreground hover:text-accent hover:bg-accent/10 transition-colors duration-150"
                              onClick={() => handleSelectProject(project)}
                            >
                              <FolderOpen className="w-3.5 h-3.5 mr-2 text-muted-foreground shrink-0" />
                              <span className="truncate">{project.name}</span>
                            </Button>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer with project count */}
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            {t("settingsManager.unified.projectSelector.projectCount", {
              count: filteredProjects.length,
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

ScopeSwitcher.displayName = "ScopeSwitcher";
