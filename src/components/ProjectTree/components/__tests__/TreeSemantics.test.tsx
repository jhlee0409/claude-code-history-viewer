import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClaudeProject } from "../../../../types";
import type { DirectoryGroup } from "../../../../utils/worktreeUtils";
import { ProjectItem } from "../ProjectItem";
import { GroupHeader } from "../GroupHeader";
import { GroupedProjectList } from "../GroupedProjectList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
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

describe("ProjectTree tree semantics", () => {
  it("renders project item as treeitem with aria-level", () => {
    const project = createProject("/tmp/project-a", "project-a");

    render(
      <ProjectItem
        project={project}
        isExpanded={false}
        isSelected={false}
        ariaLevel={2}
        onToggle={vi.fn()}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
      />
    );

    const treeItem = screen.getByRole("treeitem", { name: /project-a/i });
    expect(treeItem).toHaveAttribute("aria-level", "2");
  });

  it("renders group header as expandable treeitem", () => {
    render(
      <GroupHeader
        label="client"
        icon={<span>icon</span>}
        count={3}
        isExpanded={true}
        ariaLevel={1}
        onToggle={vi.fn()}
        variant="directory"
      />
    );

    const groupItem = screen.getByRole("treeitem", { name: /collapse client group/i });
    expect(groupItem).toHaveAttribute("aria-level", "1");
    expect(groupItem).toHaveAttribute("aria-expanded", "true");
  });

  it("renders nested group container for expanded directory groups", () => {
    const project = createProject("/tmp/project-a", "project-a");
    const directoryGroup: DirectoryGroup = {
      name: "tmp",
      path: "/tmp",
      displayPath: "/tmp",
      projects: [project],
    };

    render(
      <GroupedProjectList
        groupingMode="directory"
        projects={[]}
        directoryGroups={[directoryGroup]}
        worktreeGroups={[]}
        sessions={[]}
        selectedProject={null}
        selectedSession={null}
        isLoading={false}
        expandedProjects={new Set([`dir:${directoryGroup.path}`])}
        setExpandedProjects={vi.fn()}
        isProjectExpanded={() => false}
        handleProjectClick={vi.fn()}
        handleContextMenu={vi.fn()}
        onSessionSelect={vi.fn()}
        formatTimeAgo={(date) => date}
      />
    );

    const treeItems = screen.getAllByRole("treeitem");
    expect(treeItems[0]).toHaveAttribute("aria-level", "1");
    expect(treeItems[1]).toHaveAttribute("aria-level", "2");
    expect(screen.getByRole("group")).toBeInTheDocument();
  });
});
