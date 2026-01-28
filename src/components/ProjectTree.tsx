// src/components/ProjectTree.tsx
import React, { useState, useCallback } from "react";
import {
  Folder,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
  FolderTree,
  List,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ClaudeProject, ClaudeSession } from "../types";
import type { GroupingMode } from "../types/metadata.types";
import { cn } from "@/lib/utils";
import { getLocale } from "../utils/time";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionItem } from "./SessionItem";
import { ProjectContextMenu } from "./ProjectContextMenu";
import type { WorktreeGroup, DirectoryGroup } from "../utils/worktreeUtils";
import { getWorktreeLabel } from "../utils/worktreeUtils";

interface ContextMenuState {
  project: ClaudeProject;
  position: { x: number; y: number };
}

interface ProjectTreeProps {
  projects: ClaudeProject[];
  sessions: ClaudeSession[];
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  onProjectSelect: (project: ClaudeProject) => void;
  onSessionSelect: (session: ClaudeSession) => void;
  onGlobalStatsClick: () => void;
  isLoading: boolean;
  isViewingGlobalStats: boolean;
  width?: number;
  isResizing?: boolean;
  onResizeStart?: (e: React.MouseEvent<HTMLElement>) => void;
  // Grouping props
  groupingMode?: GroupingMode;
  worktreeGroups?: WorktreeGroup[];
  directoryGroups?: DirectoryGroup[];
  ungroupedProjects?: ClaudeProject[];
  onGroupingModeChange?: (mode: GroupingMode) => void;
  // Project visibility props
  onHideProject?: (projectPath: string) => void;
  onUnhideProject?: (projectPath: string) => void;
  isProjectHidden?: (projectPath: string) => boolean;
  // Collapse props
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projects,
  sessions,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onGlobalStatsClick,
  isLoading,
  isViewingGlobalStats,
  width,
  isResizing,
  onResizeStart,
  groupingMode = "none",
  worktreeGroups = [],
  directoryGroups = [],
  ungroupedProjects,
  onGroupingModeChange,
  onHideProject,
  onUnhideProject,
  isProjectHidden,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const { t, i18n } = useTranslation();

  // Use ungroupedProjects if provided (when grouping enabled), else use all projects
  const displayProjects = ungroupedProjects ?? projects;

  // Context menu handlers
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, project: ClaudeProject) => {
      e.preventDefault();
      setContextMenu({
        project,
        position: { x: e.clientX, y: e.clientY },
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const formatTimeAgo = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      const currentLanguage = i18n.language || "en";
      const locale = getLocale(currentLanguage);

      if (diffMins < 60) {
        return t("common.time.minutesAgo", { count: diffMins });
      } else if (diffHours < 24) {
        return t("common.time.hoursAgo", { count: diffHours });
      } else if (diffDays < 7) {
        return t("common.time.daysAgo", { count: diffDays });
      } else {
        return date.toLocaleDateString(locale, {
          month: "short",
          day: "numeric",
        });
      }
    } catch {
      return dateStr;
    }
  };

  // Nested expansion: each project/group can be expanded independently
  const toggleProject = useCallback((projectPath: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }, []);

  const isProjectExpanded = useCallback((projectPath: string) => {
    return expandedProjects.has(projectPath);
  }, [expandedProjects]);

  const sidebarStyle = isCollapsed
    ? { width: "48px" }
    : width
      ? { width: `${width}px` }
      : undefined;

  // Collapsed View
  if (isCollapsed) {
    return (
      <aside
        className={cn(
          "flex-shrink-0 bg-sidebar border-r-0 flex h-full",
          isResizing && "select-none"
        )}
        style={sidebarStyle}
      >
        <div className="flex-1 flex flex-col items-center py-3 gap-2 relative">
          {/* Right accent border */}
          <div className="absolute right-0 inset-y-0 w-[2px] bg-gradient-to-b from-accent/40 via-accent/60 to-accent/40" />

          {/* Expand Button */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center",
                "bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              )}
              title={t("project.expandSidebar", "Expand sidebar")}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}

          <div className="w-6 h-px bg-accent/20" />

          {/* Global Stats Icon */}
          <button
            onClick={onGlobalStatsClick}
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
              isViewingGlobalStats
                ? "bg-accent/20 text-accent"
                : "text-muted-foreground hover:bg-accent/10 hover:text-accent"
            )}
            title={t("components:project.globalStats", "Global Statistics")}
          >
            <Database className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-accent/20" />

          {/* Projects Count */}
          <div className="flex flex-col items-center gap-1">
            <Folder className="w-4 h-4 text-muted-foreground" />
            <span className="text-2xs font-mono text-muted-foreground">
              {projects.length}
            </span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex-shrink-0 bg-sidebar border-r-0 flex h-full",
        !width && "w-64",
        isResizing && "select-none"
      )}
      style={sidebarStyle}
    >
      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Right accent border */}
        <div className="absolute right-0 inset-y-0 w-[2px] bg-gradient-to-b from-accent/40 via-accent/60 to-accent/40" />

        {/* Sidebar Header */}
      <div className="px-4 py-3 bg-accent/5 border-b border-accent/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Collapse Button */}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  "text-muted-foreground hover:text-accent hover:bg-accent/10"
                )}
                title={t("project.collapseSidebar", "Collapse sidebar")}
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-widest text-accent">
              {t("components:project.explorer", "Explorer")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Grouping Mode Tabs */}
            {onGroupingModeChange && (
              <div className="flex items-center bg-muted/30 rounded-md p-0.5 gap-0.5">
                {/* Flat (No Grouping) */}
                <button
                  onClick={() => onGroupingModeChange("none")}
                  className={cn(
                    "p-1 rounded transition-all duration-200",
                    groupingMode === "none"
                      ? "bg-accent/20 text-accent"
                      : "text-muted-foreground hover:text-accent hover:bg-accent/10"
                  )}
                  title={t("project.groupingNone", "Flat list")}
                >
                  <List className="w-3 h-3" />
                </button>
                {/* Directory Grouping */}
                <button
                  onClick={() => onGroupingModeChange("directory")}
                  className={cn(
                    "p-1 rounded transition-all duration-200",
                    groupingMode === "directory"
                      ? "bg-blue-500/20 text-blue-500"
                      : "text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10"
                  )}
                  title={t("project.groupingDirectory", "Group by directory")}
                >
                  <FolderTree className="w-3 h-3" />
                </button>
                {/* Worktree Grouping */}
                <button
                  onClick={() => onGroupingModeChange("worktree")}
                  className={cn(
                    "p-1 rounded transition-all duration-200",
                    groupingMode === "worktree"
                      ? "bg-emerald-500/20 text-emerald-500"
                      : "text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10"
                  )}
                  title={t("project.groupingWorktree", "Group by worktree")}
                >
                  <GitBranch className="w-3 h-3" />
                </button>
              </div>
            )}
            <span className="text-xs font-mono text-accent bg-accent/10 px-2 py-0.5 rounded-full">
              {projects.length}
            </span>
          </div>
        </div>
      </div>

      {/* Projects List */}
      <OverlayScrollbarsComponent
        className="relative flex-1 py-2"
        options={{
          scrollbars: {
            theme: "os-theme-custom",
            autoHide: "leave",
            autoHideDelay: 400,
          },
          overflow: {
            x: "hidden",
          },
        }}
      >
        {projects.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted/30 flex items-center justify-center">
              <Folder className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("components:project.notFound", "No projects found")}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5 animate-stagger">
            {/* Global Stats Button */}
            <button
              onClick={onGlobalStatsClick}
              className={cn(
                "sidebar-item w-full flex items-center gap-3 mx-2 group",
                "text-left transition-all duration-300",
                isViewingGlobalStats && "active"
              )}
              style={{ width: "calc(100% - 16px)" }}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300",
                  "bg-accent/10 text-accent",
                  "group-hover:bg-accent/20 group-hover:shadow-sm group-hover:shadow-accent/20",
                  isViewingGlobalStats && "bg-accent/20 shadow-glow"
                )}
              >
                <Database className="w-4 h-4 transition-transform group-hover:scale-110" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-sidebar-foreground">
                  {t("components:project.globalStats", "Global Statistics")}
                </div>
                <div className="text-2xs text-muted-foreground">
                  {t("components:project.globalStatsDescription", "All projects overview")}
                </div>
              </div>
            </button>

            {/* Divider */}
            <div className="my-2 mx-4 h-px bg-sidebar-border" />

            {/* Directory Groups (when directory grouping is enabled) */}
            {groupingMode === "directory" && directoryGroups.map((group) => {
              const groupKey = `dir:${group.path}`;
              const isGroupExpanded = expandedProjects.has(groupKey);
              const toggleGroup = () => {
                setExpandedProjects((prev) => {
                  const next = new Set(prev);
                  if (next.has(groupKey)) {
                    next.delete(groupKey);
                  } else {
                    next.add(groupKey);
                  }
                  return next;
                });
              };

              return (
                <div key={group.path} className="space-y-0.5">
                  {/* Directory Group Header */}
                  <button
                    onClick={toggleGroup}
                    className={cn(
                      "w-full px-4 py-2 flex items-center gap-2.5",
                      "text-left transition-all duration-300",
                      "hover:bg-accent/8",
                      "border-l-2 border-transparent",
                      isGroupExpanded && "bg-accent/5 border-l-blue-500/50"
                    )}
                  >
                    {/* Expand Icon */}
                    <span
                      className={cn(
                        "transition-all duration-300",
                        isGroupExpanded ? "text-blue-500" : "text-muted-foreground"
                      )}
                    >
                      {isGroupExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>

                    {/* Directory Icon */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
                        isGroupExpanded
                          ? "bg-blue-500/20 text-blue-500"
                          : "bg-muted/50 text-muted-foreground"
                      )}
                    >
                      <FolderTree className="w-3.5 h-3.5" />
                    </div>

                    {/* Directory Path */}
                    <span
                      className={cn(
                        "text-sm truncate flex-1 transition-colors duration-300",
                        isGroupExpanded
                          ? "text-blue-600 dark:text-blue-400 font-semibold"
                          : "text-sidebar-foreground/80"
                      )}
                      title={group.path}
                    >
                      {group.displayPath}
                    </span>

                    {/* Project count badge */}
                    <span
                      className={cn(
                        "flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded",
                        "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                      )}
                    >
                      {group.projects.length}
                    </span>
                  </button>

                  {/* Expanded Directory: Projects */}
                  {isGroupExpanded && (
                    <div className="ml-4 pl-3 border-l-2 border-blue-500/20 space-y-0.5">
                      {group.projects.map((project) => {
                        const isProjectExp = isProjectExpanded(project.path);

                        return (
                          <div key={project.path}>
                            {/* Project Item */}
                            <button
                              onClick={() => {
                                onProjectSelect(project);
                                toggleProject(project.path);
                              }}
                              onContextMenu={(e) => handleContextMenu(e, project)}
                              className={cn(
                                "w-full px-2 py-1.5 flex items-center gap-2",
                                "text-left transition-all duration-200 rounded-md",
                                "hover:bg-accent/10",
                                isProjectExp && "bg-accent/15"
                              )}
                            >
                              {/* Expand Icon */}
                              <span
                                className={cn(
                                  "transition-all duration-200",
                                  isProjectExp ? "text-accent" : "text-muted-foreground"
                                )}
                              >
                                {isProjectExp ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </span>

                              {/* Folder Icon */}
                              <Folder
                                className={cn(
                                  "w-3.5 h-3.5 transition-colors",
                                  isProjectExp ? "text-accent" : "text-muted-foreground"
                                )}
                              />

                              {/* Project Name */}
                              <span
                                className={cn(
                                  "text-xs truncate flex-1 transition-colors",
                                  isProjectExp
                                    ? "text-accent font-medium"
                                    : "text-muted-foreground"
                                )}
                                title={project.actual_path}
                              >
                                {project.name}
                              </span>

                              {/* Session count */}
                              <span className="text-2xs text-muted-foreground/60 font-mono">
                                {project.session_count}
                              </span>
                            </button>

                            {/* Sessions for this project - only show for selected project */}
                            {isProjectExp && selectedProject?.path === project.path && sessions.length > 0 && !isLoading && (
                              <div className="ml-4 pl-2 space-y-1 py-1.5 border-l border-accent/30">
                                {sessions.map((session) => (
                                  <SessionItem
                                    key={session.session_id}
                                    session={session}
                                    isSelected={selectedSession?.session_id === session.session_id}
                                    onSelect={() => onSessionSelect(session)}
                                    formatTimeAgo={formatTimeAgo}
                                  />
                                ))}
                              </div>
                            )}

                            {/* Loading - only show for selected project */}
                            {isProjectExp && selectedProject?.path === project.path && isLoading && (
                              <div className="ml-4 pl-2 space-y-2 py-2 border-l border-accent/30">
                                {[1, 2].map((i) => (
                                  <div key={i} className="flex items-center gap-2 py-1.5 px-2">
                                    <Skeleton variant="circular" className="w-4 h-4" />
                                    <Skeleton className="h-3 flex-1" />
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Empty - only show for selected project */}
                            {isProjectExp && selectedProject?.path === project.path && sessions.length === 0 && !isLoading && (
                              <div className="ml-5 py-2 text-2xs text-muted-foreground">
                                {t("components:session.notFound", "No sessions")}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Worktree Groups (when worktree grouping is enabled) */}
            {groupingMode === "worktree" && worktreeGroups.map((group) => {
              // Group expansion state (separate from individual project expansion)
              const groupKey = `group:${group.parent.path}`;
              const isGroupExpanded = expandedProjects.has(groupKey);
              const toggleGroup = () => {
                setExpandedProjects((prev) => {
                  const next = new Set(prev);
                  if (next.has(groupKey)) {
                    next.delete(groupKey);
                  } else {
                    next.add(groupKey);
                  }
                  return next;
                });
              };

              // All projects in this group (main + worktrees)
              const allGroupProjects = [group.parent, ...group.children];

              return (
                <div key={group.parent.path} className="space-y-0.5">
                  {/* Group Header (not a project, just a visual grouping) */}
                  <button
                    onClick={toggleGroup}
                    className={cn(
                      "w-full px-4 py-2 flex items-center gap-2.5",
                      "text-left transition-all duration-300",
                      "hover:bg-accent/8",
                      "border-l-2 border-transparent",
                      isGroupExpanded && "bg-accent/5 border-l-emerald-500/50"
                    )}
                  >
                    {/* Expand Icon */}
                    <span
                      className={cn(
                        "transition-all duration-300",
                        isGroupExpanded ? "text-emerald-500" : "text-muted-foreground"
                      )}
                    >
                      {isGroupExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>

                    {/* Group Icon */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
                        isGroupExpanded
                          ? "bg-emerald-500/20 text-emerald-500"
                          : "bg-muted/50 text-muted-foreground"
                      )}
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                    </div>

                    {/* Group Name */}
                    <span
                      className={cn(
                        "text-sm truncate flex-1 transition-colors duration-300",
                        isGroupExpanded
                          ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                          : "text-sidebar-foreground/80"
                      )}
                    >
                      {group.parent.name}
                    </span>

                    {/* Project count badge */}
                    <span
                      className={cn(
                        "flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded",
                        "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      )}
                      title={t("project.worktreeGroup", "Worktree group")}
                    >
                      {allGroupProjects.length}
                    </span>
                  </button>

                  {/* Expanded Group: All projects at same level */}
                  {isGroupExpanded && (
                    <div className="ml-4 pl-3 border-l-2 border-emerald-500/20 space-y-0.5">
                      {allGroupProjects.map((project, idx) => {
                        const isProjectExp = isProjectExpanded(project.path);
                        const isMain = idx === 0;

                        return (
                          <div key={project.path}>
                            {/* Project Item */}
                            <button
                              onClick={() => {
                                onProjectSelect(project);
                                toggleProject(project.path);
                              }}
                              onContextMenu={(e) => handleContextMenu(e, project)}
                              className={cn(
                                "w-full px-2 py-1.5 flex items-center gap-2",
                                "text-left transition-all duration-200 rounded-md",
                                isMain
                                  ? "hover:bg-accent/10"
                                  : "hover:bg-emerald-500/10",
                                isProjectExp && (isMain ? "bg-accent/15" : "bg-emerald-500/15")
                              )}
                            >
                              {/* Expand Icon */}
                              <span
                                className={cn(
                                  "transition-all duration-200",
                                  isProjectExp
                                    ? (isMain ? "text-accent" : "text-emerald-500")
                                    : "text-muted-foreground"
                                )}
                              >
                                {isProjectExp ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </span>

                              {/* Icon: Folder for main, GitBranch for worktree */}
                              {isMain ? (
                                <Folder
                                  className={cn(
                                    "w-3.5 h-3.5 transition-colors",
                                    isProjectExp ? "text-accent" : "text-muted-foreground"
                                  )}
                                />
                              ) : (
                                <GitBranch
                                  className={cn(
                                    "w-3.5 h-3.5 transition-colors",
                                    isProjectExp
                                      ? "text-emerald-500"
                                      : "text-emerald-600/60 dark:text-emerald-400/60"
                                  )}
                                />
                              )}

                              {/* Project Name */}
                              <span
                                className={cn(
                                  "text-xs truncate flex-1 transition-colors",
                                  isProjectExp
                                    ? (isMain
                                        ? "text-accent font-medium"
                                        : "text-emerald-600 dark:text-emerald-400 font-medium")
                                    : "text-muted-foreground"
                                )}
                                title={project.actual_path}
                              >
                                {isMain ? t("project.main", "main") : getWorktreeLabel(project.actual_path)}
                              </span>

                              {/* Session count */}
                              <span className="text-2xs text-muted-foreground/60 font-mono">
                                {project.session_count}
                              </span>
                            </button>

                            {/* Sessions for this project - only show for selected project */}
                            {isProjectExp && selectedProject?.path === project.path && sessions.length > 0 && !isLoading && (
                              <div className={cn(
                                "ml-4 pl-2 space-y-1 py-1.5",
                                isMain ? "border-l border-accent/30" : "border-l border-emerald-500/30"
                              )}>
                                {sessions.map((session) => (
                                  <SessionItem
                                    key={session.session_id}
                                    session={session}
                                    isSelected={selectedSession?.session_id === session.session_id}
                                    onSelect={() => onSessionSelect(session)}
                                    formatTimeAgo={formatTimeAgo}
                                  />
                                ))}
                              </div>
                            )}

                            {/* Loading - only show for selected project */}
                            {isProjectExp && selectedProject?.path === project.path && isLoading && (
                              <div className={cn(
                                "ml-4 pl-2 space-y-2 py-2",
                                isMain ? "border-l border-accent/30" : "border-l border-emerald-500/30"
                              )}>
                                {[1, 2].map((i) => (
                                  <div key={i} className="flex items-center gap-2 py-1.5 px-2">
                                    <Skeleton variant="circular" className="w-4 h-4" />
                                    <Skeleton className="h-3 flex-1" />
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Empty - only show for selected project */}
                            {isProjectExp && selectedProject?.path === project.path && sessions.length === 0 && !isLoading && (
                              <div className="ml-5 py-2 text-2xs text-muted-foreground">
                                {t("components:session.notFound", "No sessions")}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Regular Projects (when no grouping or showing worktree ungrouped) */}
            {/* Note: directory mode shows ALL projects in groups, so no ungrouped section */}
            {(groupingMode === "none" ? projects : groupingMode === "worktree" ? displayProjects : []).map((project) => {
              const isExpanded = isProjectExpanded(project.path);

              return (
                <div key={project.path}>
                  {/* Project Item */}
                  <button
                    onClick={() => {
                      onProjectSelect(project);
                      toggleProject(project.path);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, project)}
                    className={cn(
                      "w-full px-4 py-2.5 flex items-center gap-2.5",
                      "text-left transition-all duration-300",
                      "hover:bg-accent/8 hover:pl-5",
                      "border-l-2 border-transparent",
                      isExpanded && "bg-accent/10 border-l-accent pl-5"
                    )}
                  >
                    {/* Expand Icon */}
                    <span
                      className={cn(
                        "transition-all duration-300",
                        isExpanded ? "text-accent" : "text-muted-foreground"
                      )}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>

                    {/* Folder Icon */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
                        isExpanded
                          ? "bg-accent/20 text-accent"
                          : "bg-muted/50 text-muted-foreground"
                      )}
                    >
                      <Folder className="w-3.5 h-3.5" />
                    </div>

                    {/* Project Name */}
                    <span
                      className={cn(
                        "text-sm truncate flex-1 transition-colors duration-300",
                        isExpanded
                          ? "text-accent font-semibold"
                          : "text-sidebar-foreground/80"
                      )}
                    >
                      {project.name}
                    </span>

                    {/* Session count badge */}
                    {isExpanded && sessions.length > 0 && (
                      <span className="text-2xs font-mono text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
                        {sessions.length}
                      </span>
                    )}
                  </button>

                  {/* Sessions List - only show for selected project */}
                  {isExpanded && selectedProject?.path === project.path && sessions.length > 0 && !isLoading && (
                    <div className="ml-6 pl-3 border-l-2 border-accent/20 space-y-1 py-2">
                      {sessions.map((session) => (
                        <SessionItem
                          key={session.session_id}
                          session={session}
                          isSelected={selectedSession?.session_id === session.session_id}
                          onSelect={() => onSessionSelect(session)}
                          formatTimeAgo={formatTimeAgo}
                        />
                      ))}
                    </div>
                  )}

                  {/* Loading State - only show for selected project */}
                  {isExpanded && selectedProject?.path === project.path && isLoading && (
                    <div className="ml-6 pl-3 border-l-2 border-accent/20 space-y-2 py-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-2.5 py-2 px-3">
                          <Skeleton variant="circular" className="w-5 h-5" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3 w-3/4" />
                            <Skeleton className="h-2 w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Empty Sessions - only show for selected project */}
                  {isExpanded && selectedProject?.path === project.path && sessions.length === 0 && !isLoading && (
                    <div className="ml-7 py-3 text-2xs text-muted-foreground">
                      {t("components:session.notFound", "No sessions")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </OverlayScrollbarsComponent>

      </div>

      {/* Resize Handle - Outside scroll area */}
      {onResizeStart && (
        <div
          className={cn(
            "w-3 cursor-col-resize flex-shrink-0",
            "hover:bg-accent/20 active:bg-accent/30 transition-colors",
            isResizing && "bg-accent/30"
          )}
          onMouseDown={onResizeStart}
        />
      )}

      {/* Context Menu */}
      {contextMenu && onHideProject && onUnhideProject && isProjectHidden && (
        <ProjectContextMenu
          project={contextMenu.project}
          position={contextMenu.position}
          onClose={closeContextMenu}
          onHide={onHideProject}
          onUnhide={onUnhideProject}
          isHidden={isProjectHidden(contextMenu.project.actual_path)}
        />
      )}
    </aside>
  );
};
