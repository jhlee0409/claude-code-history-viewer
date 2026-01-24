// src/components/ProjectTree.tsx
import React, { useState, useCallback } from "react";
import {
  Folder,
  ChevronDown,
  ChevronRight,
  Database,
  GitBranch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ClaudeProject, ClaudeSession } from "../types";
import { cn } from "@/lib/utils";
import { getLocale } from "../utils/time";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionItem } from "./SessionItem";
import { ProjectContextMenu } from "./ProjectContextMenu";
import type { WorktreeGroup } from "../utils/worktreeUtils";
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
  // Worktree grouping props
  worktreeGrouping?: boolean;
  worktreeGroups?: WorktreeGroup[];
  ungroupedProjects?: ClaudeProject[];
  onWorktreeGroupingToggle?: () => void;
  // Project visibility props
  onHideProject?: (projectPath: string) => void;
  onUnhideProject?: (projectPath: string) => void;
  isProjectHidden?: (projectPath: string) => boolean;
}

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projects,
  sessions,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onGlobalStatsClick,
  isLoading,
  isViewingGlobalStats,
  width,
  isResizing,
  onResizeStart,
  worktreeGrouping = false,
  worktreeGroups = [],
  ungroupedProjects,
  onWorktreeGroupingToggle,
  onHideProject,
  onUnhideProject,
  isProjectHidden,
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

  const sidebarStyle = width ? { width: `${width}px` } : undefined;

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
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-widest text-accent">
              {t("components:project.explorer", "Explorer")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Worktree Grouping Toggle */}
            {onWorktreeGroupingToggle && (
              <button
                onClick={onWorktreeGroupingToggle}
                className={cn(
                  "p-1.5 rounded-md transition-all duration-200",
                  "hover:bg-accent/20",
                  worktreeGrouping
                    ? "bg-accent/20 text-accent"
                    : "text-muted-foreground hover:text-accent"
                )}
                title={t("project.worktreeGrouping", "Group worktrees")}
              >
                <GitBranch className="w-3.5 h-3.5" />
              </button>
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

            {/* Worktree Groups (when grouping is enabled) */}
            {worktreeGrouping && worktreeGroups.map((group) => {
              const isParentExpanded = isProjectExpanded(group.parent.path);

              return (
                <div key={group.parent.path} className="space-y-0.5">
                  {/* Parent Project */}
                  <button
                    onClick={() => {
                      onProjectSelect(group.parent);
                      toggleProject(group.parent.path);
                    }}
                    onContextMenu={(e) => handleContextMenu(e, group.parent)}
                    className={cn(
                      "w-full px-4 py-2.5 flex items-center gap-2.5",
                      "text-left transition-all duration-300",
                      "hover:bg-accent/8 hover:pl-5",
                      "border-l-2 border-transparent",
                      isParentExpanded && "bg-accent/10 border-l-accent pl-5"
                    )}
                  >
                    {/* Expand Icon */}
                    <span
                      className={cn(
                        "transition-all duration-300",
                        isParentExpanded ? "text-accent" : "text-muted-foreground"
                      )}
                    >
                      {isParentExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </span>

                    {/* Folder Icon */}
                    <div
                      className={cn(
                        "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
                        isParentExpanded
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
                        isParentExpanded
                          ? "text-accent font-semibold"
                          : "text-sidebar-foreground/80"
                      )}
                    >
                      {group.parent.name}
                    </span>

                    {/* Worktree count badge */}
                    <span
                      className={cn(
                        "flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded",
                        "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      )}
                      title={t("project.worktrees", "Worktrees")}
                    >
                      <GitBranch className="w-3 h-3" />
                      {group.children.length}
                    </span>
                  </button>

                  {/* Expanded Content: Worktrees + Sessions */}
                  {isParentExpanded && (
                    <div className="ml-6 pl-3 border-l-2 border-accent/20">
                      {/* Worktree Children */}
                      <div className="space-y-0.5 py-1">
                        {group.children.map((child) => {
                          const isChildExpanded = isProjectExpanded(child.path);
                          const worktreeLabel = getWorktreeLabel(child.path);

                          return (
                            <div key={child.path}>
                              <button
                                onClick={() => {
                                  onProjectSelect(child);
                                  toggleProject(child.path);
                                }}
                                onContextMenu={(e) => handleContextMenu(e, child)}
                                className={cn(
                                  "w-full px-2 py-1.5 flex items-center gap-2",
                                  "text-left transition-all duration-200 rounded-md",
                                  "hover:bg-emerald-500/10",
                                  isChildExpanded && "bg-emerald-500/15"
                                )}
                              >
                                {/* Expand Icon */}
                                <span
                                  className={cn(
                                    "transition-all duration-200",
                                    isChildExpanded ? "text-emerald-500" : "text-muted-foreground"
                                  )}
                                >
                                  {isChildExpanded ? (
                                    <ChevronDown className="w-3 h-3" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3" />
                                  )}
                                </span>

                                {/* Worktree Icon */}
                                <GitBranch
                                  className={cn(
                                    "w-3.5 h-3.5 transition-colors",
                                    isChildExpanded
                                      ? "text-emerald-500"
                                      : "text-emerald-600/60 dark:text-emerald-400/60"
                                  )}
                                />

                                {/* Worktree Label */}
                                <span
                                  className={cn(
                                    "text-xs truncate flex-1 transition-colors",
                                    isChildExpanded
                                      ? "text-emerald-600 dark:text-emerald-400 font-medium"
                                      : "text-muted-foreground"
                                  )}
                                  title={child.path}
                                >
                                  {worktreeLabel}
                                </span>
                              </button>

                              {/* Sessions for Worktree Child */}
                              {isChildExpanded && sessions.length > 0 && !isLoading && (
                                <div className="ml-4 pl-2 border-l border-emerald-500/30 space-y-1 py-1.5">
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

                              {/* Loading for Worktree Child */}
                              {isChildExpanded && isLoading && (
                                <div className="ml-4 pl-2 border-l border-emerald-500/30 space-y-2 py-2">
                                  {[1, 2].map((i) => (
                                    <div key={i} className="flex items-center gap-2 py-1.5 px-2">
                                      <Skeleton variant="circular" className="w-4 h-4" />
                                      <Skeleton className="h-3 flex-1" />
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Empty for Worktree Child */}
                              {isChildExpanded && sessions.length === 0 && !isLoading && (
                                <div className="ml-5 py-2 text-2xs text-muted-foreground">
                                  {t("components:session.notFound", "No sessions")}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Divider between worktrees and sessions */}
                      {group.children.length > 0 && (sessions.length > 0 || isLoading) && (
                        <div className="h-px bg-border/50 my-1.5" />
                      )}

                      {/* Sessions for Parent (shown when parent is expanded but not selecting a child) */}
                      {sessions.length > 0 && !isLoading && !group.children.some(c => isProjectExpanded(c.path)) && (
                        <div className="space-y-1 py-1.5">
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

                      {/* Loading for Parent */}
                      {isLoading && !group.children.some(c => isProjectExpanded(c.path)) && (
                        <div className="space-y-2 py-2">
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

                      {/* Empty for Parent */}
                      {sessions.length === 0 && !isLoading && !group.children.some(c => isProjectExpanded(c.path)) && (
                        <div className="py-2 text-2xs text-muted-foreground">
                          {t("components:session.notFound", "No sessions")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Regular Projects (ungrouped or when grouping disabled) */}
            {displayProjects.map((project) => {
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

                  {/* Sessions List */}
                  {isExpanded && sessions.length > 0 && !isLoading && (
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

                  {/* Loading State */}
                  {isExpanded && isLoading && (
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

                  {/* Empty Sessions */}
                  {isExpanded && sessions.length === 0 && !isLoading && (
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
          isHidden={isProjectHidden(contextMenu.project.path)}
        />
      )}
    </aside>
  );
};
