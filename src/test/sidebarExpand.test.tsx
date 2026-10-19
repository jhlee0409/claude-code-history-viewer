/**
 * Plan §9b F3 (T7): expanding or collapsing a project row is tree state, not
 * navigation.
 *
 * - The chevron and ArrowRight / ArrowLeft only expand or collapse; they
 *   never open or leave a project, so a conversation stays open.
 * - A click on a closed project's row opens it and expands it.
 * - Re-clicking the open project only expands / collapses it; it never
 *   leaves the project.
 * - One project row is expanded at a time.
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ClaudeProject } from "@/types";
import { GroupedProjectList } from "@/components/ProjectTree/components/GroupedProjectList";

vi.mock("@/services/api", () => ({
  api: vi.fn(async () => ({ sessions: [], total: 0, nextOffset: 0, hasMore: false })),
}));
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
      />
    </div>
  );
}

const row = (p: ClaudeProject) =>
  document.querySelector<HTMLElement>(`[data-tree-node="project"][data-project-path="${p.path}"]`)!;
const chevron = (p: ClaudeProject) => row(p).querySelector<HTMLElement>("[data-chevron]")!;
const expandedKeys = () => screen.getByRole("tree").getAttribute("data-expanded");

describe("sidebar expand is not select (F3)", () => {
  it("collapsing the open project's row (keyboard) does not leave the project", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.keyDown(row(OPEN), { key: "ArrowLeft" });
    expect(expandedKeys()).toBe("");
    fireEvent.keyDown(row(OPEN), { key: "ArrowRight" });
    expect(expandedKeys()).toBe(OPEN.path);

    expect(onProjectClick).not.toHaveBeenCalled();
  });

  it("re-clicking the open project collapses and re-expands it, never leaving it", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.click(row(OPEN));
    expect(expandedKeys()).toBe("");
    fireEvent.click(row(OPEN));
    expect(expandedKeys()).toBe(OPEN.path);
    expect(onProjectClick).not.toHaveBeenCalled();
  });

  it("the chevron and ArrowRight expand another project without opening it", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.click(chevron(OTHER));
    // One expanded project row at a time.
    expect(expandedKeys()).toBe(OTHER.path);
    fireEvent.keyDown(row(OTHER), { key: "ArrowLeft" });
    fireEvent.keyDown(row(OTHER), { key: "ArrowRight" });
    expect(expandedKeys()).toBe(OTHER.path);
    expect(onProjectClick).not.toHaveBeenCalled();
  });

  it("a click on a closed project's row opens it and expands it", () => {
    const onProjectClick = vi.fn();
    render(<Harness onProjectClick={onProjectClick} />);

    fireEvent.click(row(OTHER));

    expect(onProjectClick).toHaveBeenCalledWith(OTHER);
    expect(expandedKeys()).toBe(OTHER.path);
  });
});
