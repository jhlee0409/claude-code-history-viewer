import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { EmptyScreen } from "@/layouts/shell/screens";
import { StatusBar } from "@/layouts/shell/StatusBar";
import { ProjectTree } from "@/components/ProjectTree";
import { ProjectSessions } from "@/components/ProjectTree/components/ProjectSessions";
import { MessageViewer } from "@/components/MessageViewer";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { AppErrorType, type ClaudeProject, type ClaudeSession } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn() }));
const session: ClaudeSession = { session_id: "s", actual_session_id: "s", file_path: "/history/project/s.jsonl",
  project_name: "project", message_count: 1, last_modified: "2026-10-01T00:00:00Z",
  first_message_time: "2026-10-01T00:00:00Z", last_message_time: "2026-10-01T00:00:00Z",
  has_tool_use: false, has_errors: false, summary: "Loaded session" };

const initial = useAppStore.getState();
const project: ClaudeProject = {
  name: "Loaded project", path: "/history/project", actual_path: "/work/project",
  session_count: 1, message_count: 1, last_modified: "2026-10-01T00:00:00Z", provider: "claude",
};

function Tree({ phone = false }: { phone?: boolean }) {
  const projects = useAppStore((s) => s.projects);
  const loading = useAppStore((s) => s.isLoadingProjects || s.isLoadingSessions);
  return <ProjectTree projects={projects} sessions={[]} selectedProject={null} selectedSession={null}
    onProjectSelect={vi.fn()} onSessionSelect={vi.fn()} onGlobalStatsClick={vi.fn()}
    isLoading={loading} asideId={phone ? "mobile-project-explorer" : "project-explorer"}
    onClose={phone ? vi.fn() : undefined} />;
}

function expectNoFalseEmpty() {
  for (const key of ["session.select", "session.selectDescription", "session.noProjects.title", "session.noProjects.claudeTitle", "project.notFound"]) {
    expect(screen.queryAllByText(i18n.t(key))).toHaveLength(0);
  }
}

describe("loading truth in main area and project explorer", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });
  beforeEach(() => {
    vi.mocked(api).mockReset();
    localStorage.clear();
    useAppStore.setState({ ...initial, projects: [], isLoading: false, isLoadingProjects: false,
      isDetectingProviders: false, projectsScanned: true, error: null });
  });
  afterAll(() => { useAppStore.setState(initial); });

  it.each(["isLoading", "isLoadingProjects", "isDetectingProviders"] as const)("main: %s is unknown, not a selection or empty prompt", (flag) => {
    useAppStore.setState({ [flag]: true });
    const { container } = render(<EmptyScreen />);
    expectNoFalseEmpty();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"] .animate-shimmer').length).toBeGreaterThan(0);
    expect(container.querySelector('[role="alert"], [aria-live]')).not.toBeInTheDocument();
    act(() => useAppStore.setState({ [flag]: false }));
    expect(screen.getByRole("heading", { name: i18n.t("session.noProjects.claudeTitle") })).toBeInTheDocument();
  });

  it.each(["main", "explorer", "phone", "footer"])("%s: before the first scan starts, no result has been established", (surface) => {
    useAppStore.setState({ projectsScanned: false });
    const footer = <StatusBar isDesktop={false} appVersion="" projectCount={0} sessionCount={0} messageCount={null}
      isLoading={false} isLoadingProjects={false} isLoadingSessions={false} isLoadingMessages={false} isLoadingStats={false} />;
    const { container } = render(surface === "main" ? <EmptyScreen /> : surface === "footer" ? footer : <Tree phone={surface === "phone"} />);
    expectNoFalseEmpty();
    if (surface === "footer") {
      expect(screen.queryByText(i18n.t("project.count", { count: 0 }))).not.toBeInTheDocument();
      expect(screen.queryByText(i18n.t("session.count", { count: 0 }))).not.toBeInTheDocument();
    } else {
      expect(container.querySelector('[aria-busy="true"] .animate-shimmer')).toBeInTheDocument();
    }
  });

  it.each(["main", "explorer", "phone", "footer"])("%s: failed initialization without a scan is not settled empty or busy", (surface) => {
    useAppStore.setState({ projectsScanned: false, error: { type: AppErrorType.CLAUDE_FOLDER_NOT_FOUND, message: "Folder unavailable" } });
    const footer = <StatusBar isDesktop={false} appVersion="" projectCount={0} sessionCount={0} messageCount={null}
      isLoading={false} isLoadingProjects={false} isLoadingSessions={false} isLoadingMessages={false} isLoadingStats={false} />;
    const { container } = render(surface === "main" ? <EmptyScreen /> : surface === "footer" ? footer : <Tree phone={surface === "phone"} />);
    expectNoFalseEmpty();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
    if (surface === "footer") {
      expect(screen.queryByText(i18n.t("project.count", { count: 0 }))).not.toBeInTheDocument();
      expect(screen.queryByText(i18n.t("session.count", { count: 0 }))).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(i18n.t("common.errorOccurred"))).toBeInTheDocument();
    }
    act(() => useAppStore.setState({ error: null, projectsScanned: true }));
    if (surface === "footer") {
      expect(screen.getByText(i18n.t("project.count", { count: 0 }))).toBeInTheDocument();
      expect(screen.getByText(i18n.t("session.count", { count: 0 }))).toBeInTheDocument();
    } else {
      expect(screen.getByText(i18n.t("session.noProjects.claudeTitle"))).toBeInTheDocument();
    }
  });

  it("status bar: initial counts are unknown; settled zeros and cached counts stay visible", () => {
    const props = { isDesktop: false, appVersion: "", projectCount: 0, sessionCount: 0, messageCount: null,
      isLoading: true, isLoadingProjects: true, isLoadingSessions: false, isLoadingMessages: false, isLoadingStats: false };
    const { rerender } = render(<StatusBar {...props} />);
    expect(screen.queryByText(i18n.t("project.count", { count: 0 }))).not.toBeInTheDocument();
    expect(screen.queryByText(i18n.t("session.count", { count: 0 }))).not.toBeInTheDocument();
    rerender(<StatusBar {...props} isLoading={false} isLoadingProjects={false} />);
    expect(screen.getByText(i18n.t("project.count", { count: 0 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("session.count", { count: 0 }))).toBeInTheDocument();
    rerender(<StatusBar {...props} projectCount={2} sessionCount={3} />);
    expect(screen.getByText(i18n.t("project.count", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("session.count", { count: 3 }))).toBeInTheDocument();
  });

  it("status bar: a pending transcript count is unknown, but a settled empty transcript is zero", () => {
    const props = { isDesktop: false, appVersion: "", projectCount: 1, sessionCount: 1, messageCount: 0,
      isLoading: false, isLoadingProjects: false, isLoadingSessions: false, isLoadingMessages: true, isLoadingStats: false };
    const { rerender } = render(<StatusBar {...props} />);
    expect(screen.queryByText(i18n.t("message.count", { count: 0 }))).not.toBeInTheDocument();
    rerender(<StatusBar {...props} isLoadingMessages={false} />);
    expect(screen.getByText(i18n.t("message.count", { count: 0 }))).toBeInTheDocument();
    rerender(<StatusBar {...props} messageCount={4} />);
    expect(screen.getByText(i18n.t("message.count", { count: 4 }))).toBeInTheDocument();
  });

  it("main: pending → content → refresh keeps the resolved selection prompt", () => {
    useAppStore.setState({ isLoadingProjects: true });
    render(<EmptyScreen />);
    expectNoFalseEmpty();
    act(() => useAppStore.setState({ projects: [project], isLoadingProjects: false }));
    expect(screen.getByText(i18n.t("session.select"))).toBeInTheDocument();
    act(() => useAppStore.setState({ isLoadingProjects: true }));
    expect(screen.getByText(i18n.t("session.select"))).toBeInTheDocument();
  });

  it.each([false, true].flatMap((phone) => (["isLoading", "isLoadingProjects", "isDetectingProviders"] as const).map((flag) => ({ phone, flag }))))("explorer ($phone, $flag): pending has neither false empty nor zero count; settled empty has both", ({ phone, flag }) => {
    useAppStore.setState({ [flag]: true });
    const { container } = render(<Tree phone={phone} />);
    expectNoFalseEmpty();
    const region = screen.getByRole("region", { name: i18n.t("project.projects") });
    expect(within(region).queryByText("0")).not.toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector('[aria-hidden="true"] .animate-shimmer')).toBeInTheDocument();
    act(() => useAppStore.setState({ [flag]: false }));
    expect(within(region).getByText("0")).toBeInTheDocument();
    expect(within(region).getByText(i18n.t("session.noProjects.claudeTitle"))).toBeInTheDocument();
  });

  it.each([false, true])("sessions (showAll=%s): pending → empty → content → refresh", (showAll) => {
    const props = { project, isOpen: true, sessions: [], sessionsTotal: 0, hasMoreSessions: false,
      selectedSession: null, isLoading: true, isLoadingMoreSessions: false, showAll,
      onShowAll: vi.fn(), onSessionSelect: vi.fn(), onLoadMoreSessions: vi.fn(), formatTimeAgo: () => "now" };
    const { container, rerender } = render(<ProjectSessions {...props} />);
    expect(screen.queryByText(i18n.t("project.sessions.empty"))).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"] .animate-shimmer')).toBeInTheDocument();
    rerender(<ProjectSessions {...props} isLoading={false} />);
    expect(screen.getByText(i18n.t("project.sessions.empty"))).toBeInTheDocument();
    rerender(<ProjectSessions {...props} isLoading={false} sessions={[session]} sessionsTotal={1} />);
    expect(screen.getByText(session.summary!)).toBeInTheDocument();
    rerender(<ProjectSessions {...props} sessions={[session]} sessionsTotal={1} />);
    expect(screen.getByText(session.summary!)).toBeInTheDocument();
    expect(container.querySelector(".animate-shimmer")).not.toBeInTheDocument();
  });

  it("full session list: settled empty is localized", async () => {
    await i18n.changeLanguage("ko");
    try {
      render(<ProjectSessions project={project} isOpen sessions={[]}
        sessionsTotal={0} hasMoreSessions={false} selectedSession={null} isLoading={false}
        isLoadingMoreSessions={false} showAll onShowAll={vi.fn()} onSessionSelect={vi.fn()}
        onLoadMoreSessions={vi.fn()} formatTimeAgo={() => "now"} />);
      expect(screen.getByText(i18n.t("project.sessions.empty"))).toBeInTheDocument();
    } finally { await i18n.changeLanguage("en"); }
  });

  it("full session list: existing rows survive background refresh", () => {
    render(<ProjectSessions project={project} isOpen sessions={[session]}
      sessionsTotal={1} hasMoreSessions={false} selectedSession={null} isLoading
      isLoadingMoreSessions={false} showAll onShowAll={vi.fn()} onSessionSelect={vi.fn()}
      onLoadMoreSessions={vi.fn()} formatTimeAgo={() => "now"} />);
    expect(screen.getByText(session.summary!)).toBeInTheDocument();
  });

  it("sessions: preview rejection is an error, not settled empty", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(api).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    const { container } = render(<ProjectSessions project={project} isOpen={false} sessions={[]}
      sessionsTotal={0} hasMoreSessions={false} selectedSession={null} isLoading={false}
      isLoadingMoreSessions={false} showAll={false} onShowAll={vi.fn()} onSessionSelect={vi.fn()}
      onLoadMoreSessions={vi.fn()} formatTimeAgo={() => "now"} />);
    expect(container.querySelector('[aria-busy="true"] .animate-shimmer')).toBeInTheDocument();
    await act(async () => { reject(new Error("unreadable")); });
    expect(screen.getByText(i18n.t("project.sessions.loadError"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("project.sessions.empty"))).not.toBeInTheDocument();
  });

  it.each(["prop", "store"])("transcript: %s loading → settled empty uses scoped skeletons", (source) => {
    useAppStore.setState({ selectedSession: session, isLoadingMessages: source === "store" });
    const props = { messages: [], selectedSession: session, isLoading: source === "prop",
      sessionSearch: initial.sessionSearch, onSearchChange: vi.fn(), onFilterTypeChange: vi.fn(), onClearSearch: vi.fn() };
    const { container, rerender } = render(<MessageViewer {...props} />);
    expect(screen.queryByText(i18n.t("messageViewer.noMessages"))).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"] .animate-shimmer')).toBeInTheDocument();
    act(() => useAppStore.setState({ isLoadingMessages: false }));
    rerender(<MessageViewer {...props} isLoading={false} />);
    expect(screen.getByText(i18n.t("messageViewer.noMessages"))).toBeInTheDocument();
  });

  it.each([false, true].flatMap((phone) => ["provider", "search"].map((filter) => ({ phone, filter }))))("explorer ($phone, $filter): partial scans cannot establish a filtered zero", ({ phone, filter }) => {
    const codex: ClaudeProject = { ...project, name: "codex-result", path: "codex://result", actual_path: "/work/codex-result", provider: "codex" };
    useAppStore.setState({ projects: [project], projectsScanned: false, isLoadingProjects: true,
      activeProviders: filter === "provider" ? ["codex"] : ["claude", "codex"],
      providers: [
        { id: "claude", display_name: "Claude Code", base_path: "/history", is_available: true },
        { id: "codex", display_name: "Codex CLI", base_path: "/codex", is_available: true },
      ], hasDetectedProviders: true });
    render(<Tree phone={phone} />);
    if (filter === "search") fireEvent.change(screen.getByRole("textbox", { name: i18n.t("project.filterPlaceholder") }), { target: { value: "codex-result" } });
    const region = screen.getByRole("region", { name: i18n.t("project.projects") });
    expect(within(region).queryByText(i18n.t("project.notFound"))).not.toBeInTheDocument();
    expect(within(region).queryByText("0")).not.toBeInTheDocument();
    expect(region.querySelector('.animate-shimmer')).toBeInTheDocument();
    act(() => useAppStore.setState({ isLoadingProjects: false, projectsScanned: true }));
    expect(within(region).getByText(i18n.t("project.notFound"))).toBeInTheDocument();
    expect(within(region).getByText("0")).toBeInTheDocument();
    act(() => useAppStore.setState({ projects: [project, codex], isLoadingProjects: true }));
    expect(within(region).getByRole("treeitem", { name: /codex-result/ })).toBeInTheDocument();
    expect(region.querySelector('.animate-shimmer')).not.toBeInTheDocument();
  });

  it("explorer: refresh retains existing rows and their known count", () => {
    useAppStore.setState({ projects: [project] });
    render(<Tree />);
    expect(screen.getByRole("treeitem", { name: /project/ })).toBeInTheDocument();
    act(() => useAppStore.setState({ isLoadingProjects: true }));
    expect(screen.getByRole("treeitem", { name: /project/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: i18n.t("project.projects") }).parentElement).toHaveTextContent("1");
  });
});
