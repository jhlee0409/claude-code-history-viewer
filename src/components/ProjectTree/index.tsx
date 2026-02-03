// src/components/ProjectTree/index.tsx
import React, { useCallback } from "react";
import {
  Folder,
  Database,
  List,
  FolderTree,
  GitBranch,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { cn } from "@/lib/utils";
import { getLocale } from "../../utils/time";
import { ProjectContextMenu } from "../ProjectContextMenu";
import { useProjectTreeState } from "./hooks/useProjectTreeState";
import { GroupedProjectList } from "./components/GroupedProjectList";
import type { ProjectTreeProps } from "./types";

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projects,
  sessions,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onSessionHover,
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
  const { t, i18n } = useTranslation();

  const {
    expandedProjects,
    setExpandedProjects,
    toggleProject,
    isProjectExpanded,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  } = useProjectTreeState(groupingMode);

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

  // Unified project click handler: syncs expand state with selection + accordion behavior
  const handleProjectClick = useCallback(
    (project: typeof selectedProject) => {
      if (!project) return;

      const isCurrentlySelected = selectedProject?.path === project.path;

      if (isCurrentlySelected) {
        // Deselecting: also collapse
        setExpandedProjects((prev) => {
          const next = new Set(prev);
          next.delete(project.path);
          return next;
        });
      } else {
        // Selecting new project: collapse all other projects (accordion), expand this one
        setExpandedProjects((prev) => {
          const next = new Set<string>();
          // Preserve group-level expansions (dir:, group: prefixed keys)
          for (const key of prev) {
            if (key.startsWith("dir:") || key.startsWith("group:")) {
              next.add(key);
            }
          }
          next.add(project.path);
          return next;
        });
      }

      onProjectSelect(project);
    },
    [selectedProject, onProjectSelect, setExpandedProjects]
  );

  const sidebarStyle = isCollapsed ? { width: "48px" } : width ? { width: `${width}px` } : undefined;

  // Collapsed View
  if (isCollapsed) {
    return (
      <aside
        className={cn("flex-shrink-0 bg-sidebar border-r-0 flex h-full", isResizing && "select-none")}
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
              isViewingGlobalStats ? "bg-accent/20 text-accent" : "text-muted-foreground hover:bg-accent/10 hover:text-accent"
            )}
            title={t("components:project.globalStats", "Global Statistics")}
          >
            <Database className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-accent/20" />

          {/* Projects Count */}
          <div className="flex flex-col items-center gap-1">
            <Folder className="w-4 h-4 text-muted-foreground" />
            <span className="text-2xs font-mono text-muted-foreground">{projects.length}</span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn("flex-shrink-0 bg-sidebar border-r-0 flex h-full", !width && "w-64", isResizing && "select-none")}
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
                      groupingMode === "none" ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-accent hover:bg-accent/10"
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
              <p className="text-sm text-muted-foreground">{t("components:project.notFound", "No projects found")}</p>
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
                  <span title="Global Statistics">
                    <Database className="w-4 h-4 transition-transform group-hover:scale-110" />
                  </span>
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

              {/* Grouped Project List */}
              <GroupedProjectList
                groupingMode={groupingMode}
                projects={projects}
                directoryGroups={directoryGroups}
                worktreeGroups={worktreeGroups}
                ungroupedProjects={ungroupedProjects}
                sessions={sessions}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                isLoading={isLoading}
                expandedProjects={expandedProjects}
                setExpandedProjects={setExpandedProjects}
                isProjectExpanded={isProjectExpanded}
                toggleProject={toggleProject}
                handleProjectClick={handleProjectClick}
                handleContextMenu={handleContextMenu}
                onSessionSelect={onSessionSelect}
                onSessionHover={onSessionHover}
                formatTimeAgo={formatTimeAgo}
              />
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
