import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClaudeProject } from "../../../../types";
import type { DirectoryGroup, WorktreeGroup } from "../../../../utils/worktreeUtils";
import { GroupedProjectList } from "../GroupedProjectList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../ProjectItem", () => ({
  ProjectItem: ({
    project,
    onToggle,
    onClick,
  }: {
    project: ClaudeProject;
    onToggle: () => void;
    onClick: () => void;
  }) => (
    <div data-testid={`project-item-${project.path}`}>
      <button data-testid={`project-toggle-${project.path}`} onClick={onToggle} type="button">
        toggle
      </button>
      <button data-testid={`project-row-${project.path}`} onClick={onClick} type="button">
        row
      </button>
    </div>
  ),
}));

vi.mock("../SessionList", () => ({
  SessionList: () => <div data-testid="session-list" />,
}));

function createProject(path: string, name: string): ClaudeProject {
  return {
    name,
    path,
    actual_path: path,
    session_count: 1,
    message_count: 1,
    last_modified: "2026-02-21T00:00:00Z",
    provider: "claude",
  };
}

describe("GroupedProjectList", () => {
  function renderList(options: {
    groupingMode: "none" | "directory" | "worktree";
    project: ClaudeProject;
    handleProjectClick: ReturnType<typeof vi.fn>;
    projects?: ClaudeProject[];
    directoryGroups?: DirectoryGroup[];
    worktreeGroups?: WorktreeGroup[];
    expandedProjects?: Set<string>;
  }) {
    render(
      <GroupedProjectList
        groupingMode={options.groupingMode}
        projects={options.projects ?? [options.project]}
        directoryGroups={options.directoryGroups ?? []}
        worktreeGroups={options.worktreeGroups ?? []}
        sessions={[]}
        selectedProject={null}
        selectedSession={null}
        isLoading={false}
        expandedProjects={options.expandedProjects ?? new Set<string>()}
        setExpandedProjects={vi.fn()}
        isProjectExpanded={() => false}
        handleProjectClick={options.handleProjectClick}
        handleContextMenu={vi.fn()}
        onSessionSelect={vi.fn()}
        formatTimeAgo={(date) => date}
      />
    );
  }

  it("routes chevron toggle through project click handler in flat mode", () => {
    const project = createProject("/tmp/project-a", "project-a");
    const handleProjectClick = vi.fn();

    renderList({
      groupingMode: "none",
      project,
      handleProjectClick,
    });

    fireEvent.click(screen.getByTestId(`project-toggle-${project.path}`));

    expect(handleProjectClick).toHaveBeenCalledTimes(1);
    expect(handleProjectClick).toHaveBeenCalledWith(project);
  });

  it("routes chevron toggle through project click handler in directory mode", () => {
    const project = createProject("/tmp/project-a", "project-a");
    const handleProjectClick = vi.fn();
    const directoryGroup: DirectoryGroup = {
      name: "tmp",
      path: "/tmp",
      displayPath: "/tmp",
      projects: [project],
    };

    renderList({
      groupingMode: "directory",
      project,
      handleProjectClick,
      projects: [],
      directoryGroups: [directoryGroup],
      expandedProjects: new Set<string>([`dir:${directoryGroup.path}`]),
    });

    fireEvent.click(screen.getByTestId(`project-toggle-${project.path}`));

    expect(handleProjectClick).toHaveBeenCalledTimes(1);
    expect(handleProjectClick).toHaveBeenCalledWith(project);
  });

  it("routes chevron toggle through project click handler in worktree mode", () => {
    const project = createProject("/tmp/project-a", "project-a");
    const handleProjectClick = vi.fn();
    const worktreeGroup: WorktreeGroup = {
      parent: project,
      children: [],
    };

    renderList({
      groupingMode: "worktree",
      project,
      handleProjectClick,
      projects: [],
      worktreeGroups: [worktreeGroup],
      expandedProjects: new Set<string>([`group:${project.path}`]),
    });

    fireEvent.click(screen.getByTestId(`project-toggle-${project.path}`));

    expect(handleProjectClick).toHaveBeenCalledTimes(1);
    expect(handleProjectClick).toHaveBeenCalledWith(project);
  });
});
