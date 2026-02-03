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
  sessions: ClaudeSession[];
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  isLoading: boolean;
  expandedProjects: Set<string>;
  setExpandedProjects: React.Dispatch<React.SetStateAction<Set<string>>>;
  isProjectExpanded: (path: string) => boolean;
  toggleProject: (path: string) => void;
  handleProjectClick: (project: ClaudeProject) => void;
  handleContextMenu: (e: React.MouseEvent, project: ClaudeProject) => void;
  onSessionSelect: (session: ClaudeSession) => void;
  onSessionHover?: (session: ClaudeSession) => void;
  formatTimeAgo: (date: string) => string;
}

export const GroupedProjectList: React.FC<GroupedProjectListProps> = ({
  groupingMode,
  projects,
  directoryGroups,
  worktreeGroups,
  ungroupedProjects,
  sessions,
  selectedProject,
  selectedSession,
  isLoading,
  expandedProjects,
  setExpandedProjects,
  isProjectExpanded,
  toggleProject,
  handleProjectClick,
  handleContextMenu,
  onSessionSelect,
  onSessionHover,
  formatTimeAgo,
}) => {
  const { t: _t } = useTranslation();
  void _t; // Reserved for future i18n usage

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
    variant: "default" | "main" | "worktree" = "default"
  ) => {
    const isExpanded = isProjectExpanded(project.path);
    const showSessions = isExpanded && selectedProject?.path === project.path;

    return (
      <div key={project.path}>
        <ProjectItem
          project={project}
          isExpanded={isExpanded}
          isSelected={selectedProject?.path === project.path}
          onToggle={() => toggleProject(project.path)}
          onClick={() => handleProjectClick(project)}
          onContextMenu={(e) => handleContextMenu(e, project)}
          variant={variant}
        />
        {showSessions && (
          <SessionList
            sessions={sessions}
            selectedSession={selectedSession}
            isLoading={isLoading}
            onSessionSelect={onSessionSelect}
            onSessionHover={onSessionHover}
            formatTimeAgo={formatTimeAgo}
            variant={variant}
          />
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
            <div key={group.path} className="space-y-0.5">
              <GroupHeader
                label={group.displayPath}
                icon={<span title="Directory"><FolderTree className="w-3.5 h-3.5" /></span>}
                count={group.projects.length}
                isExpanded={isGroupExpanded}
                onToggle={() => toggleGroup(groupKey, group.projects)}
                variant="directory"
              />
              {isGroupExpanded && (
                <div className="ml-4 pl-3 border-l-2 border-blue-500/20 space-y-0.5">
                  {group.projects.map((project) => renderProjectWithSessions(project, "default"))}
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
    const displayProjects = ungroupedProjects ?? projects;

    return (
      <>
        {worktreeGroups.map((group) => {
          const groupKey = `group:${group.parent.path}`;
          const isGroupExpanded = expandedProjects.has(groupKey);
          const allGroupProjects = [group.parent, ...group.children];

          return (
            <div key={group.parent.path} className="space-y-0.5">
              <GroupHeader
                label={group.parent.name}
                icon={<GitBranch className="w-3.5 h-3.5" />}
                count={allGroupProjects.length}
                isExpanded={isGroupExpanded}
                onToggle={() => toggleGroup(groupKey, allGroupProjects)}
                variant="worktree"
              />
              {isGroupExpanded && (
                <div className="ml-4 pl-3 border-l-2 border-emerald-500/20 space-y-0.5">
                  {allGroupProjects.map((project, idx) =>
                    renderProjectWithSessions(project, idx === 0 ? "main" : "worktree")
                  )}
                </div>
              )}
            </div>
          );
        })}
        {displayProjects.map((project) => renderProjectWithSessions(project, "default"))}
      </>
    );
  }

  // Strategy 3: No Grouping (Flat List)
  return <>{projects.map((project) => renderProjectWithSessions(project, "default"))}</>;
};
