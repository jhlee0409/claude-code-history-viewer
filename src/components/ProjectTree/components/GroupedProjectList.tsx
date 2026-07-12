// src/components/ProjectTree/components/GroupedProjectList.tsx
import React from "react";
import { FolderTree, GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ClaudeProject, ClaudeSession } from "../../../types";
import type { WorktreeGroup, DirectoryGroup } from "../../../utils/worktreeUtils";
import type { GroupingStrategy } from "../types";
import { ProjectItem } from "./ProjectItem";
import { SessionList } from "./SessionList";
import { GroupHeader } from "./GroupHeader";

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
  handleContextMenu: (e: React.MouseEvent, project: ClaudeProject) => void;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  onLoadMoreSessions?: () => void;
  formatTimeAgo: (date: string) => string;
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
    ariaLevel = 1
  ) => {
    const isExpanded = isProjectExpanded(project.path);
    const showSessions = isExpanded && selectedProject?.path === project.path;

    // Collapsed rows skip offscreen layout/paint entirely — with thousands of
    // projects this is what keeps sidebar scrolling and search re-filters
    // cheap without virtualizing the (a11y-tree-navigated, nested) list.
    // The expanded row is excluded: content-visibility's paint containment
    // would break the sticky selection bar and the nested virtualized
    // session list inside it.
    const rowStyle: React.CSSProperties | undefined = showSessions
      ? undefined
      : { contentVisibility: "auto", containIntrinsicSize: "auto 48px" };

    return (
      <div key={project.path} role="none" style={rowStyle}>
        <ProjectItem
          project={project}
          isExpanded={isExpanded}
          isSelected={selectedProject?.path === project.path}
          ariaLevel={ariaLevel}
          onToggle={() => handleProjectClick(project)}
          onClick={() => handleProjectClick(project)}
          onContextMenu={(e) => handleContextMenu(e, project)}
          variant={variant}
          showProviderBadge={showProviderBadge}
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

  // Strategy 1: Directory Grouping
  if (groupingMode === "directory") {
    return (
      <>
        {directoryGroups.map((group) => {
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
                <div role="group" className="ml-4 pl-3 border-l-2 border-blue-500/20 space-y-0.5">
                  {group.projects.map((project) => renderProjectWithSessions(project, "default", 2))}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  // Strategy 2: Worktree Grouping
  if (groupingMode === "worktree") {
    const groupedPaths = new Set(
      worktreeGroups.flatMap((group) => [group.parent.path, ...group.children.map((child) => child.path)])
    );
    const displayProjects = ungroupedProjects ?? projects.filter((project) => !groupedPaths.has(project.path));

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
                <div role="group" className="ml-4 pl-3 border-l-2 border-emerald-500/20 space-y-0.5">
                  {allGroupProjects.map((project, idx) =>
                    renderProjectWithSessions(project, idx === 0 ? "main" : "worktree", 2)
                  )}
                </div>
              )}
            </div>
          );
        })}
        {displayProjects.map((project) => renderProjectWithSessions(project, "default", 1))}
      </>
    );
  }

  // Strategy 3: No Grouping (Flat List)
  return <>{projects.map((project) => renderProjectWithSessions(project, "default", 1))}</>;
};
