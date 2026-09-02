// src/components/ProjectTree/components/GroupedProjectList.tsx
import React from "react";
import { AlertCircle, FolderTree, GitBranch, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeProject, ClaudeSession } from "../../../types";
import type { WorktreeGroup, DirectoryGroup } from "../../../utils/worktreeUtils";
import type { GroupingStrategy } from "../types";
import { ProjectItem } from "./ProjectItem";
import { SessionList } from "./SessionList";
import { GroupHeader } from "./GroupHeader";
import { isProjectPathUnavailable, isProjectTemporary } from "../../../utils/pathUtils";

interface GroupedProjectListProps {
  groupingMode: GroupingStrategy;
  projects: ClaudeProject[];
  directoryGroups: DirectoryGroup[];
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
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  formatTimeAgo: (date: string) => string;
  inlineSessions?: boolean;
}

export const GroupedProjectList: React.FC<GroupedProjectListProps> = ({
  groupingMode,
  projects,
  directoryGroups,
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
}) => {
  const { t } = useTranslation();

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

  const renderProjectWithSessions = (
    project: ClaudeProject,
    variant: "default" | "main" | "worktree" = "default",
    ariaLevel = 1,
    providerSiblings: ClaudeProject[] = []
  ) => {
    const isExpanded = isProjectExpanded(project.path);
    const showSessions = inlineSessions && isExpanded && selectedProject?.path === project.path;

    // NOTE: collapsed rows previously used `content-visibility: auto` to skip
    // offscreen paint (#460). Removed because WebKit (WKWebView/WebKitGTK)
    // mis-tracks viewport intersection when the list mutates quickly — e.g.
    // rapid provider-filter toggling — leaving some rows rendered without
    // their chevron/folder icons until expansion forced a repaint. Collapsed
    // rows are cheap to paint; search re-filter cost is covered by
    // useDeferredValue, so the optimization is not worth the rendering bug.

    return (
      <div key={project.path} role="none">
        <ProjectItem
          project={project}
          isExpanded={isExpanded}
          isSelected={selectedProject?.path === project.path}
          ariaLevel={ariaLevel}
          onToggle={() => handleProjectClick(project)}
          onClick={() => handleProjectClick(project)}
          onContextMenu={(e) => handleContextMenu(e, project, providerSiblings)}
          variant={variant}
          showProviderBadge={showProviderBadge}
          providerSiblings={providerSiblings}
          onSelectSibling={handleProjectClick}
          hasInlineChildren={inlineSessions}
        />
        {showSessions && (
          <div role="none">
            <SessionList
              sessions={sessions}
              sessionsTotal={sessionsTotal}
              hasMoreSessions={hasMoreSessions}
              selectedSession={selectedSession}
              isLoading={isLoading}
              isLoadingMoreSessions={isLoadingMoreSessions}
              onSessionSelect={onSessionSelect}
              onSessionHover={onSessionHover}
              onLoadMoreSessions={onLoadMoreSessions}
              formatTimeAgo={formatTimeAgo}
              variant={variant}
            />
          </div>
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
            isTemporary ? <Timer className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />
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

  // Strategy 2: Worktree Grouping
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

  // Strategy 3: No Grouping (Flat List)
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
