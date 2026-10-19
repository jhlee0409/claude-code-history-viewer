// src/components/ProjectTree/components/GroupedProjectList.tsx
import React from "react";
import { CircleAlert, Clock, FolderTree, GitBranch, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeProject, ClaudeSession } from "../../../types";
import {
  TIME_BUCKET_LABEL_KEYS,
  type WorktreeGroup,
  type DirectoryGroup,
  type TimeGroup,
} from "../../../utils/worktreeUtils";
import type { GroupingStrategy, SessionSelectHandler } from "../types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { ProjectItem } from "./ProjectItem";
import { ProjectSessions } from "./ProjectSessions";
import { GroupHeader } from "./GroupHeader";
import { isProjectPathUnavailable, isProjectTemporary } from "../../../utils/pathUtils";

interface GroupedProjectListProps {
  groupingMode: GroupingStrategy;
  projects: ClaudeProject[];
  directoryGroups: DirectoryGroup[];
  timeGroups?: TimeGroup[];
  worktreeGroups: WorktreeGroup[];
  ungroupedProjects?: ClaudeProject[];
  showProviderBadge?: boolean;
  sessions: ClaudeSession[];
  sessionsTotal?: number;
  hasMoreSessions?: boolean;
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  isLoadingMoreSessions?: boolean;
  expandedProjects: Set<string>;
  setExpandedProjects: React.Dispatch<React.SetStateAction<Set<string>>>;
  isProjectExpanded: (path: string) => boolean;
  handleProjectClick: (project: ClaudeProject) => void;
  handleContextMenu: (e: React.MouseEvent, project: ClaudeProject, providerSiblings?: ClaudeProject[]) => void;
  onSessionSelect: SessionSelectHandler;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  formatTimeAgo: (date: string) => string;
  inlineSessions?: boolean;
  /** An app-level screen is open: the open project is kept context (C3). */
  isSelectionRetained?: boolean;
}

/** Expansion keys of group rows, as opposed to project paths. */
const isGroupKey = (key: string) =>
  key.startsWith("dir:") || key.startsWith("group:") || key.startsWith("time:");

export const GroupedProjectList: React.FC<GroupedProjectListProps> = ({
  groupingMode,
  projects,
  directoryGroups,
  timeGroups = [],
  worktreeGroups,
  ungroupedProjects,
  showProviderBadge = true,
  sessions,
  sessionsTotal = sessions.length,
  hasMoreSessions = false,
  selectedProject,
  selectedSession,
  isLoading,
  isLoadingMoreSessions = false,
  expandedProjects,
  setExpandedProjects,
  isProjectExpanded,
  handleProjectClick,
  handleContextMenu,
  onSessionSelect,
  onSessionHover,
  onLoadMoreSessions = () => {},
  formatTimeAgo,
  inlineSessions = true,
  isSelectionRetained = false,
}) => {
  const { t } = useTranslation();
  const isSelectionMode = useAppStore((s) => s.isSessionSelectionMode);
  const enterSessionSelectionMode = useAppStore((s) => s.enterSessionSelectionMode);
  // The project whose full list "Show all" opened (one at a time).
  const [showAllPath, setShowAllPath] = React.useState<string | null>(null);

  const toggleGroup = (groupKey: string, projectsInGroup: ClaudeProject[]) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
        // Also collapse child projects when collapsing group
        for (const p of projectsInGroup) {
          next.delete(p.path);
        }
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  /*
    Expanding and collapsing a row is tree state only (plan §9b F3): it never
    opens or leaves a project, and an open conversation stays where it is.
    One project row is expanded at a time (only it lists its sessions);
    group rows (directory, worktree, time buckets) keep their own state.
  */
  const setProjectExpanded = (project: ClaudeProject, expanded: boolean) => {
    setExpandedProjects((prev) => {
      if (prev.has(project.path) === expanded) return prev;
      const next = new Set<string>();
      for (const key of prev) {
        if (isGroupKey(key)) next.add(key);
      }
      if (expanded) next.add(project.path);
      return next;
    });
  };

  const toggleProject = (project: ClaudeProject, isExpanded: boolean) =>
    setProjectExpanded(project, !isExpanded);

  /*
    A row click opens a closed project (and expands it). On the open project
    it only expands or collapses: re-clicking never leaves the project (F3).
  */
  const clickProject = (project: ClaudeProject, isExpanded: boolean) => {
    if (selectedProject?.path === project.path) {
      toggleProject(project, isExpanded);
      return;
    }
    setProjectExpanded(project, true);
    handleProjectClick(project);
  };

  const showAllFor = (project: ClaudeProject, showAll: boolean) => {
    setShowAllPath(showAll ? project.path : null);
    // The full list is the open project's: "Show all" on another opens it.
    if (showAll && selectedProject?.path !== project.path) handleProjectClick(project);
  };

  const renderProjectWithSessions = (
    project: ClaudeProject,
    variant: "default" | "main" | "worktree" = "default",
    ariaLevel = 1,
    providerSiblings: ClaudeProject[] = []
  ) => {
    const isExpanded = isProjectExpanded(project.path);
    const isOpen = selectedProject?.path === project.path;
    const showSessions = inlineSessions && isExpanded;
    const canSelect = isOpen && isExpanded && sessions.length > 1 && !isSelectionMode;

    // NOTE: collapsed rows previously used `content-visibility: auto` to skip
    // offscreen paint (#460). Removed because WebKit (WKWebView/WebKitGTK)
    // mis-tracks viewport intersection when the list mutates quickly — e.g.
    // rapid provider-filter toggling — leaving some rows rendered without
    // their chevron/folder icons until expansion forced a repaint. Collapsed
    // rows are cheap to paint; search re-filter cost is covered by
    // useDeferredValue, so the optimization is not worth the rendering bug.

    return (
      <div key={project.path} role="none" className="relative">
        <ProjectItem
          project={project}
          isExpanded={isExpanded}
          isSelected={isOpen}
          isRetained={isOpen && isSelectionRetained}
          ariaLevel={ariaLevel}
          onToggle={() => toggleProject(project, isExpanded)}
          onClick={() => clickProject(project, isExpanded)}
          onContextMenu={(e) => handleContextMenu(e, project, providerSiblings)}
          variant={variant}
          showProviderBadge={showProviderBadge}
          providerSiblings={providerSiblings}
          hasInlineChildren={inlineSessions}
          reserveTrailingSpace={canSelect}
        />
        {/* Drawn over the row, not inside it: a button inside the tree
            item would nest interactive controls. */}
        {canSelect && (
          <button
            type="button"
            onClick={enterSessionSelectionMode}
            className={cn(
              "absolute right-1 top-1 h-5 px-1.5 rounded text-caption font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
            aria-label={t("session.selection.enter")}
            title={t("session.selection.enter")}
          >
            {t("project.select")}
          </button>
        )}
        {showSessions && (
          <ProjectSessions
            project={project}
            isOpen={isOpen}
            sessions={sessions}
            sessionsTotal={sessionsTotal}
            hasMoreSessions={hasMoreSessions}
            selectedSession={selectedSession}
            isLoading={isLoading}
            isLoadingMoreSessions={isLoadingMoreSessions}
            showAll={showAllPath === project.path}
            onShowAll={showAllFor}
            onSessionSelect={onSessionSelect}
            onSessionHover={onSessionHover}
            onLoadMoreSessions={onLoadMoreSessions}
            formatTimeAgo={formatTimeAgo}
          />
        )}
      </div>
    );
  };

  /**
   * Collapsed-by-default bucket for projects the user rarely wants in the main
   * list (unavailable working directories, OS temp locations). One header row
   * instead of N rows of noise.
   */
  const renderBucketGroup = (
    kind: "unavailable" | "temporary",
    bucketProjects: ClaudeProject[]
  ) => {
    if (bucketProjects.length === 0) return null;

    const groupKey = `group:${kind}-projects`;
    const isGroupExpanded = expandedProjects.has(groupKey);
    const isTemporary = kind === "temporary";

    return (
      <div className="space-y-0.5" role="none" data-testid={`${kind}-projects-group`}>
        <GroupHeader
          groupKey={groupKey}
          label={
            isTemporary
              ? t("project.temporaryGroup", "Temporary locations")
              : t("project.pathUnavailableGroup", "Unavailable locations")
          }
          icon={
            isTemporary ? <Timer className="w-3.5 h-3.5" /> : <CircleAlert className="w-3.5 h-3.5" />
          }
          count={bucketProjects.length}
          isExpanded={isGroupExpanded}
          ariaLevel={1}
          onToggle={() => toggleGroup(groupKey, bucketProjects)}
          variant={kind}
        />
        {isGroupExpanded && (
          <div
            role="group"
            className={
              isTemporary
                ? "ml-4 pl-3 border-l-2 border-border space-y-0.5"
                : "ml-4 pl-3 border-l-2 border-warning/20 space-y-0.5"
            }
          >
            {bucketProjects.map((project) => renderProjectWithSessions(project, "default", 2))}
          </div>
        )}
      </div>
    );
  };

  /** Split projects into main list / temporary bucket / unavailable bucket. */
  const partition = (list: ClaudeProject[]) => ({
    main: list.filter((p) => !isProjectPathUnavailable(p) && !isProjectTemporary(p)),
    temporary: list.filter(isProjectTemporary),
    unavailable: list.filter(isProjectPathUnavailable),
  });

  // Strategy 1: Directory Grouping
  if (groupingMode === "directory") {
    const allDirectoryProjects = directoryGroups.flatMap((group) => group.projects);
    const { temporary: temporaryProjects, unavailable: unavailableProjects } =
      partition(allDirectoryProjects);
    const availableDirectoryGroups = directoryGroups
      .map((group) => ({
        ...group,
        projects: partition(group.projects).main,
      }))
      .filter((group) => group.projects.length > 0);

    return (
      <>
        {availableDirectoryGroups.map((group) => {
          const groupKey = `dir:${group.path}`;
          const isGroupExpanded = expandedProjects.has(groupKey);

          return (
            <div key={group.path} className="space-y-0.5" role="none">
              <GroupHeader
                groupKey={groupKey}
                label={group.displayPath}
                icon={<span title={t("project.groupingDirectory", "Group by directory")}><FolderTree className="w-3.5 h-3.5" /></span>}
                count={group.projects.length}
                isExpanded={isGroupExpanded}
                ariaLevel={1}
                onToggle={() => toggleGroup(groupKey, group.projects)}
                variant="directory"
              />
              {isGroupExpanded && (
                <div role="group" className="ml-4 pl-3 border-l-2 border-info/20 space-y-0.5">
                  {group.projects.map((project) => renderProjectWithSessions(project, "default", 2))}
                </div>
              )}
            </div>
          );
        })}
        {renderBucketGroup("temporary", temporaryProjects)}
        {renderBucketGroup("unavailable", unavailableProjects)}
      </>
    );
  }

  // Strategy 2: Time (Session Recency) Grouping
  if (groupingMode === "time") {
    const allTimeProjects = timeGroups.flatMap((group) => group.projects);
    const { temporary: temporaryProjects, unavailable: unavailableProjects } =
      partition(allTimeProjects);
    const availableTimeGroups = timeGroups
      .map((group) => ({
        ...group,
        projects: partition(group.projects).main,
      }))
      .filter((group) => group.projects.length > 0);

    return (
      <>
        {availableTimeGroups.map((group) => {
          const groupKey = `time:${group.bucket}`;
          const isGroupExpanded = expandedProjects.has(groupKey);

          return (
            <div key={group.bucket} className="space-y-0.5" role="none">
              <GroupHeader
                groupKey={groupKey}
                label={t(TIME_BUCKET_LABEL_KEYS[group.bucket])}
                icon={<span title={t("project.groupingTime", "Group by time")}><Clock className="w-3.5 h-3.5" /></span>}
                count={group.projects.length}
                isExpanded={isGroupExpanded}
                ariaLevel={1}
                onToggle={() => toggleGroup(groupKey, group.projects)}
                variant="time"
              />
              {isGroupExpanded && (
                <div role="group" className="ml-4 pl-3 border-l-2 border-violet-500/20 space-y-0.5">
                  {group.projects.map((project) => renderProjectWithSessions(project, "default", 2))}
                </div>
              )}
            </div>
          );
        })}
        {renderBucketGroup("temporary", temporaryProjects)}
        {renderBucketGroup("unavailable", unavailableProjects)}
      </>
    );
  }

  // Strategy 3: Worktree Grouping
  if (groupingMode === "worktree") {
    const groupedPaths = new Set(
      worktreeGroups.flatMap((group) => [group.parent.path, ...group.children.map((child) => child.path)])
    );
    const displayProjects = ungroupedProjects ?? projects.filter((project) => !groupedPaths.has(project.path));
    const {
      main: availableDisplayProjects,
      temporary: temporaryDisplayProjects,
      unavailable: unavailableDisplayProjects,
    } = partition(displayProjects);

    return (
      <>
        {worktreeGroups.map((group) => {
          const groupKey = `group:${group.parent.path}`;
          const isGroupExpanded = expandedProjects.has(groupKey);
          const allGroupProjects = [group.parent, ...group.children];

          return (
            <div key={group.parent.path} className="space-y-0.5" role="none">
              <GroupHeader
                groupKey={groupKey}
                label={group.parent.name}
                icon={<GitBranch className="w-3.5 h-3.5" />}
                count={allGroupProjects.length}
                isExpanded={isGroupExpanded}
                ariaLevel={1}
                onToggle={() => toggleGroup(groupKey, allGroupProjects)}
                variant="worktree"
              />
              {isGroupExpanded && (
                <div role="group" className="ml-4 pl-3 border-l-2 border-success/20 space-y-0.5">
                  {allGroupProjects.map((project, idx) =>
                    renderProjectWithSessions(project, idx === 0 ? "main" : "worktree", 2)
                  )}
                </div>
              )}
            </div>
          );
        })}
        {availableDisplayProjects.map((project) => renderProjectWithSessions(project, "default", 1))}
        {renderBucketGroup("temporary", temporaryDisplayProjects)}
        {renderBucketGroup("unavailable", unavailableDisplayProjects)}
      </>
    );
  }

  // Strategy 4: No Grouping (Flat List)
  const { main: availableProjects, temporary: temporaryProjects, unavailable: unavailableProjects } =
    partition(projects);

  return (
    <>
      {mergeByFolder(availableProjects, selectedProject).map(({ lead, siblings }) =>
        renderProjectWithSessions(lead, "default", 1, siblings)
      )}
      {renderBucketGroup("temporary", temporaryProjects)}
      {renderBucketGroup("unavailable", unavailableProjects)}
    </>
  );
};

/**
 * One row per working directory. Several providers (Claude Code, Codex,
 * oh-my-pi…) record sessions for the same folder under different store
 * paths; showing them as five rows fragments the list. The selected
 * project leads its group so highlight and expansion follow the user;
 * otherwise the most recent one (input order) leads.
 */
function mergeByFolder(
  list: ClaudeProject[],
  selectedProject: ClaudeProject | null
): Array<{ lead: ClaudeProject; siblings: ClaudeProject[] }> {
  const byFolder: Record<string, ClaudeProject[]> = {};
  const order: string[] = [];
  for (const project of list) {
    const key = project.actual_path || project.path;
    if (!byFolder[key]) {
      byFolder[key] = [];
      order.push(key);
    }
    byFolder[key]!.push(project);
  }
  return order.map((key) => {
    const group = byFolder[key]!;
    const leadIndex = selectedProject
      ? group.findIndex((p) => p.path === selectedProject.path)
      : -1;
    const lead = group[leadIndex === -1 ? 0 : leadIndex]!;
    return { lead, siblings: group.filter((p) => p !== lead) };
  });
}
