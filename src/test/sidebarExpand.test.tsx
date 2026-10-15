/**
 * Plan §9b F3: expanding or collapsing a project row is tree state, not
 * navigation. Collapsing the open project's row (ArrowLeft) while reading
 * its conversation keeps the conversation and the project.
 *
 * Expanding a closed row still opens that project: the tree lists sessions of
 * the open project only, and lifting that (plus re-click = collapse) is the
 * sidebar rework, T7.
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ClaudeProject } from "@/types";
import { GroupedProjectList } from "@/components/ProjectTree/components/GroupedProjectList";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
      i18n: { language: "en" },
    }),
  };
});

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 2,
  message_count: 2,
  last_modified: "2026-01-01T00:00:00.000Z",
  provider: "claude",
});
const OPEN = project("open");
const OTHER = project("other");

function Harness({ onProjectClick }: { onProjectClick: (p: ClaudeProject) => void }) {
  const [expanded, setExpanded] = useState(() => new Set([OPEN.path]));
  return (
    <div role="tree" data-expanded={[...expanded].join(",")}>
      <GroupedProjectList
        groupingMode="none"
        projects={[OPEN, OTHER]}
        ungroupedProjects={[OPEN, OTHER]}
        directoryGroups={[]}
        worktreeGroups={[]}
        sessions={[]}
        selectedProject={OPEN}
        selectedSession={null}
        isLoading={false}
        expandedProjects={expanded}
        setExpandedProjects={setExpanded}
        isProjectExpanded={(path) => expanded.has(path)}
        handleProjectClick={onProjectClick}
        handleContextMenu={vi.fn()}
        onSessionSelect={vi.fn()}
        formatTimeAgo={() => ""}
        inlineSessions={false}
      />
    </div>
  );
}

const row = (p: ClaudeProject) =>
  document.querySelector<HTMLElement>(`[data-tree-node="project"][data-project-path="${p.path}"]`)!;

describe("sidebar expand is not select (F3)", () => {
  it("collapsing the open project's row does not leave the project", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.keyDown(row(OPEN), { key: "ArrowLeft" });

    expect(onProjectClick).not.toHaveBeenCalled();
    expect(screen.getByRole("tree").getAttribute("data-expanded")).toBe("");
  });

  it("re-expanding the open project's collapsed row expands it in place", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.keyDown(row(OPEN), { key: "ArrowLeft" });
    fireEvent.keyDown(row(OPEN), { key: "ArrowRight" });

    expect(onProjectClick).not.toHaveBeenCalled();
    expect(screen.getByRole("tree").getAttribute("data-expanded")).toBe(OPEN.path);
  });

  it("expanding a closed row still opens that project", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.keyDown(row(OTHER), { key: "ArrowRight" });

    expect(onProjectClick).toHaveBeenCalledWith(OTHER);
  });
});
