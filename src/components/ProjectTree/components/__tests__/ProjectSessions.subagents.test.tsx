import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PlatformProvider } from "@/contexts/platform";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { ProjectSessions } from "../ProjectSessions";

const project: ClaudeProject = {
  provider: "opencode", name: "Fixture", path: "opencode://fixture", actual_path: "/fixture",
  session_count: 2, subagent_count: 2, message_count: 4, last_modified: "2026-11-09T00:00:00Z",
};
const session = (id: string, summary: string, day: number, parent?: ClaudeSession): ClaudeSession => ({
  provider: "opencode", session_id: `opencode://${id}`, actual_session_id: id,
  file_path: `${project.path}/${id}`, project_name: project.name, summary, message_count: 1,
  first_message_time: "2026-11-01T00:00:00Z", last_message_time: "2026-11-01T00:00:00Z",
  last_modified: `2026-11-0${day}T00:00:00Z`, has_tool_use: false, has_errors: false,
  parent_session_id: parent?.session_id,
});
const parent = session("parent", "Plan the rollout", 9);
const child = session("child", "Check the schema", 9, parent);
const grandchild = session("leaf", "Read the migration diff", 9, child);
const other = session("other", "Fix login", 8);
const sessions = [other, grandchild, child, parent];
const initial = useAppStore.getState();
const row = (label: RegExp) => screen.getByRole("treeitem", { name: label });
const props = {
  project, isOpen: true, sessions, sessionsTotal: 2, hasMoreSessions: false, selectedSession: null,
  isLoading: false, isLoadingMoreSessions: false, showAll: false,
  onShowAll: vi.fn(), onSessionSelect: vi.fn(), onLoadMoreSessions: vi.fn(),
  formatTimeAgo: (activity: string) => activity,
};

describe("OpenCode and Kilo sidebar branches", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ ...initial, sidebarFilterResult: null, sessionSortOrder: "newest" });
  });
  afterEach(() => { useAppStore.setState(initial); });

  it("shows the recent parent first, lets the user disclose two levels, and opens either transcript", () => {
    render(<ProjectSessions {...props} />);
    const root = row(/Plan the rollout/);
    expect(screen.getAllByRole("treeitem")[0]).toBe(root);
    expect(root).toHaveAttribute("aria-expanded", "false");
    expect(within(root).getByTitle("1 subagent run")).toBeVisible();
    expect(screen.queryByText(child.summary!)).not.toBeInTheDocument();

    fireEvent.click(root);
    expect(props.onSessionSelect).toHaveBeenLastCalledWith(parent, project);
    fireEvent.click(within(root).getByTitle("1 subagent run"));
    const run = row(/Check the schema/);
    expect(run).toHaveAttribute("aria-level", "3");
    expect(props.onSessionSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(run, { key: "ArrowRight" });
    const leaf = row(/Read the migration diff/);
    expect(leaf).toHaveAttribute("aria-level", "4");
    fireEvent.click(leaf);
    expect(props.onSessionSelect).toHaveBeenLastCalledWith(grandchild, project);
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(screen.queryByText(grandchild.summary!)).not.toBeInTheDocument();
  });

  it("reveals an already selected child below its ancestors even beyond the five-row preview", async () => {
    const oldParent = { ...parent, last_modified: "2026-11-01T00:00:00Z" };
    const roots = Array.from({ length: 6 }, (_, i) => session(`root-${i}`, `Ordinary session ${i}`, 8));
    render(<ProjectSessions {...props} selectedSession={grandchild}
      sessions={[...roots, oldParent, child, grandchild]} sessionsTotal={7} />);
    expect(await screen.findByRole("treeitem", { name: /Read the migration diff/, selected: true })).toBeVisible();
    expect(row(/Plan the rollout/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/Check the schema/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/Show all.*7/)).toBeVisible();
    expect(screen.getAllByText(/Ordinary session/)).toHaveLength(4);
  });

  it("uses root counts for page progress and selects a visible child without selecting hidden runs", () => {
    useAppStore.setState({ selectedProject: project, sessionsTotal: 4, hasMoreSessions: true });
    render(
      <PlatformProvider>
        <ProjectSessions {...props} showAll sessionsTotal={4} hasMoreSessions selectedSession={parent} />
      </PlatformProvider>
    );
    expect(screen.getByRole("button", { name: /Load more.*2 \/ 4/ })).toBeVisible();
    fireEvent.click(within(row(/Plan the rollout/)).getByTitle("1 subagent run"));
    fireEvent.click(row(/Check the schema/), { shiftKey: true });
    expect(row(/Plan the rollout/)).toHaveAttribute("aria-checked", "true");
    expect(row(/Check the schema/)).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(grandchild.summary!)).not.toBeInTheDocument();
    expect(useAppStore.getState().sessionSelectionIds).toEqual([parent.session_id, child.session_id]);
  });

  it("keeps ancestor context around a child matched by the sidebar filter", () => {
    useAppStore.setState({ sidebarFilterResult: {
      projectPaths: [project.path], sessionMatchesByProject: { [project.path]: [grandchild] },
      sessionContextByProject: { [project.path]: [parent, child] }, sessionIds: [grandchild.session_id],
    } });
    render(<ProjectSessions {...props} isOpen={false} sessions={[]} />);
    expect(row(/Plan the rollout/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/Read the migration diff/)).toHaveAttribute("aria-level", "4");
    expect(screen.queryByText(other.summary!)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(i18n.t("project.sessions.filterMatches", { count: 1 }));
  });
});
