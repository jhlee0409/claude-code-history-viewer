// src/components/ProjectTree/index.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  Folder,
  Database,
  List,
  FolderTree,
  GitBranch,
  PanelLeftClose,
  PanelLeft,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { cn } from "@/lib/utils";
import { getLocale } from "../../utils/time";
import { ProjectContextMenu } from "../ProjectContextMenu";
import { useProjectTreeState } from "./hooks/useProjectTreeState";
import { GroupedProjectList } from "./components/GroupedProjectList";
import type { ProjectTreeProps } from "./types";
import type { ProviderId } from "../../types";

type ProviderTabId = "all" | ProviderId;
const PROVIDER_ORDER: ProviderId[] = ["claude", "codex", "opencode"];
const getProviderId = (project: { provider?: ProviderId }): ProviderId =>
  project.provider ?? "claude";

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
  const [selectedProviderFilters, setSelectedProviderFilters] = useState<ProviderId[]>([]);

  const {
    expandedProjects,
    setExpandedProjects,
    isProjectExpanded,
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  } = useProjectTreeState(groupingMode);

  const isAllProvidersSelected = selectedProviderFilters.length === 0;
  const showProviderBadge = selectedProviderFilters.length !== 1;

  const matchesProviderFilter = useCallback(
    (project: (typeof projects)[number]) =>
      isAllProvidersSelected || selectedProviderFilters.includes(getProviderId(project)),
    [isAllProvidersSelected, selectedProviderFilters]
  );

  const handleProviderTabClick = useCallback((provider: ProviderTabId) => {
    if (provider === "all") {
      setSelectedProviderFilters([]);
      return;
    }

    setSelectedProviderFilters((prev) => {
      if (prev.length === 0) {
        return [provider];
      }

      if (prev.includes(provider)) {
        const next = prev.filter((id) => id !== provider);
        return next.length > 0 ? next : [];
      }

      const next = [...prev, provider];
      return PROVIDER_ORDER.filter((id) => next.includes(id));
    });
  }, []);

  const providerCounts = useMemo(() => {
    const counts: Record<ProviderTabId, number> = {
      all: projects.length,
      claude: 0,
      codex: 0,
      opencode: 0,
    };

    for (const project of projects) {
      counts[getProviderId(project)] += 1;
    }

    return counts;
  }, [projects]);

  const filteredProjects = useMemo(
    () => projects.filter(matchesProviderFilter),
    [projects, matchesProviderFilter]
  );

  const filteredDirectoryGroups = useMemo(() => {
    if (isAllProvidersSelected) {
      return directoryGroups;
    }

    return directoryGroups
      .map((group) => ({
        ...group,
        projects: group.projects.filter(matchesProviderFilter),
      }))
      .filter((group) => group.projects.length > 0);
  }, [directoryGroups, isAllProvidersSelected, matchesProviderFilter]);

  const { filteredWorktreeGroups, filteredUngroupedProjects } = useMemo(() => {
    const baseUngrouped = ungroupedProjects ?? projects;

    if (isAllProvidersSelected) {
      return {
        filteredWorktreeGroups: worktreeGroups,
        filteredUngroupedProjects: baseUngrouped,
      };
    }

    const nextGroups: typeof worktreeGroups = [];
    const movedChildren: (typeof projects)[number][] = [];

    for (const group of worktreeGroups) {
      const includeParent = matchesProviderFilter(group.parent);
      const matchingChildren = group.children.filter(matchesProviderFilter);

      if (includeParent) {
        nextGroups.push({
          ...group,
          children: matchingChildren,
        });
      } else if (matchingChildren.length > 0) {
        movedChildren.push(...matchingChildren);
      }
    }

    const baseFiltered = baseUngrouped.filter(matchesProviderFilter);
    const seenPaths = new Set(baseFiltered.map((project) => project.path));
    const movedChildrenToAdd = movedChildren.filter((child) => {
      if (seenPaths.has(child.path)) {
        return false;
      }
      seenPaths.add(child.path);
      return true;
    });
    const nextUngrouped = [...baseFiltered, ...movedChildrenToAdd];

    return {
      filteredWorktreeGroups: nextGroups,
      filteredUngroupedProjects: nextUngrouped,
    };
  }, [worktreeGroups, ungroupedProjects, projects, isAllProvidersSelected, matchesProviderFilter]);

  const providerTabs = useMemo(
    () => [
      {
        id: "all" as const,
        label: t("session.board.controls.all", "ALL"),
        count: providerCounts.all,
      },
      {
        id: "claude" as const,
        label: t("common.provider.claude", "Claude Code"),
        count: providerCounts.claude,
      },
      {
        id: "codex" as const,
        label: t("common.provider.codex", "Codex CLI"),
        count: providerCounts.codex,
      },
      {
        id: "opencode" as const,
        label: t("common.provider.opencode", "OpenCode"),
        count: providerCounts.opencode,
      },
    ],
    [providerCounts, t]
  );

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
            title={t("project.globalStats")}
          >
            <Database className="w-4 h-4" />
          </button>

          <div className="w-6 h-px bg-accent/20" />

          {/* Projects Count */}
          <div className="flex flex-col items-center gap-1">
            <Folder className="w-4 h-4 text-muted-foreground" />
            <span className="text-2xs font-mono text-muted-foreground">{filteredProjects.length}</span>
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
                {t("project.explorer")}
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
                {filteredProjects.length}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {providerTabs.map((tab) => {
              const isActive = tab.id === "all"
                ? isAllProvidersSelected
                : selectedProviderFilters.includes(tab.id);
              const isDisabled = tab.id !== "all" && tab.count === 0;

              return (
                <button
                  key={tab.id}
                  onClick={() => handleProviderTabClick(tab.id)}
                  disabled={isDisabled}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-2xs font-medium transition-colors",
                    isDisabled
                      ? "bg-muted/20 text-muted-foreground/50 border-transparent cursor-not-allowed"
                      : isActive
                      ? "bg-accent/15 text-accent border-accent/30"
                      : "bg-muted/30 text-muted-foreground border-transparent hover:bg-accent/8 hover:text-accent"
                  )}
                  title={tab.label}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "px-1 py-0.5 rounded text-[10px] font-mono leading-none",
                      isActive ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setSelectedProviderFilters([])}
              disabled={isAllProvidersSelected}
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-2xs font-medium transition-colors",
                isAllProvidersSelected
                  ? "bg-muted/20 text-muted-foreground/50 border-transparent cursor-not-allowed"
                  : "bg-muted/30 text-muted-foreground border-transparent hover:bg-accent/8 hover:text-accent"
              )}
              title={t("project.resetProviderFilters", "Reset")}
              aria-label={t("project.resetProviderFilters", "Reset")}
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t("project.resetProviderFilters", "Reset")}</span>
            </button>
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
          {filteredProjects.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted/30 flex items-center justify-center">
                <Folder className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">{t("project.notFound")}</p>
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
                    {t("project.globalStats")}
                  </div>
                  <div className="text-2xs text-muted-foreground">
                    {t("project.globalStatsDescription")}
                  </div>
                </div>
              </button>

              {/* Divider */}
              <div className="my-2 mx-4 h-px bg-sidebar-border" />

              {/* Grouped Project List */}
              <GroupedProjectList
                groupingMode={groupingMode}
                projects={filteredProjects}
                directoryGroups={filteredDirectoryGroups}
                worktreeGroups={filteredWorktreeGroups}
                ungroupedProjects={filteredUngroupedProjects}
                showProviderBadge={showProviderBadge}
                sessions={sessions}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                isLoading={isLoading}
                expandedProjects={expandedProjects}
                setExpandedProjects={setExpandedProjects}
                isProjectExpanded={isProjectExpanded}
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
