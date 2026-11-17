/**
 * An expanded project that the sidebar filter shows only because some of its
 * sessions matched by name lists just those sessions, in the preview and in
 * the full list.
 */
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ProjectSessions } from "../ProjectSessions";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import type { ClaudeProject, ClaudeSession } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn() }));

const project: ClaudeProject = {
  name: "web-app", path: "/history/web-app", actual_path: "/work/web-app",
  session_count: 3, message_count: 3, last_modified: "2026-10-03T00:00:00Z", provider: "claude",
};

const session = (id: string, summary: string, day: number): ClaudeSession => ({
  session_id: id, actual_session_id: id, file_path: `/history/web-app/${id}.jsonl`,
  project_name: "web-app", message_count: 1, last_modified: `2026-10-0${day}T00:00:00Z`,
  first_message_time: `2026-10-0${day}T00:00:00Z`, last_message_time: `2026-10-0${day}T00:00:00Z`,
  has_tool_use: false, has_errors: false, summary,
});

const login = session("s1", "Fix login bug", 1);
const apiClient = session("s2", "Refactor api client", 2);
const tests = session("s3", "Add tests", 3);

const initial = useAppStore.getState();

const baseProps = {
  project,
  sessionsTotal: 3,
  hasMoreSessions: false,
  selectedSession: null,
  isLoading: false,
  isLoadingMoreSessions: false,
  onShowAll: vi.fn(),
  onSessionSelect: vi.fn(),
  onLoadMoreSessions: vi.fn(),
  formatTimeAgo: () => "now",
};

describe("ProjectSessions with the sidebar filter", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });
  beforeEach(() => {
    vi.mocked(api).mockReset();
    useAppStore.setState({ ...initial, sidebarFilterResult: null });
  });
  afterAll(() => { useAppStore.setState(initial); });

  it("previews only the matched sessions of a closed project, without loading its list", () => {
    useAppStore.setState({
      sidebarFilterResult: {
        projectPaths: [project.path],
        sessionMatchesByProject: { [project.path]: [login] },
      },
    });
    render(<ProjectSessions {...baseProps} isOpen={false} sessions={[]} showAll={false} />);

    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.queryByText("Add tests")).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("project.sessions.filterMatches", { count: 1 }))).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("narrows the open project's full list and drops paging", () => {
    useAppStore.setState({
      sidebarFilterResult: {
        projectPaths: [project.path],
        sessionMatchesByProject: { [project.path]: [login, apiClient] },
      },
    });
    render(
      <ProjectSessions {...baseProps} isOpen sessions={[login, apiClient, tests]} hasMoreSessions showAll />
    );

    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Refactor api client")).toBeInTheDocument();
    expect(screen.queryByText("Add tests")).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.loadMore"))).not.toBeInTheDocument();
  });

  it("lists every session of a project matched by its own name", () => {
    useAppStore.setState({
      sidebarFilterResult: { projectPaths: [project.path], sessionMatchesByProject: {} },
    });
    render(<ProjectSessions {...baseProps} isOpen sessions={[login, apiClient, tests]} showAll={false} />);

    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Add tests")).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("project.sessions.filterMatches", { count: 3 }))).not.toBeInTheDocument();
  });
});
