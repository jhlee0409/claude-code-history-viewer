import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { toast } from "sonner";
import { api } from "../services/api";
import {
  createProjectSlice,
  type ProjectSlice,
} from "../store/slices/projectSlice";
import {
  AppErrorType,
  DEFAULT_USER_METADATA,
  type ClaudeProject,
  type ClaudeSession,
  type ProviderInfo,
  type UserMetadata,
} from "../types";

vi.mock("../services/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type TestStore = ProjectSlice & {
  providers: ProviderInfo[];
  userMetadata: UserMetadata;
  updateUserSettings: ReturnType<typeof vi.fn>;
  excludeSidechain: boolean;
  analytics: { currentView: "messages" | "analytics" | "tokenStats" | "recentEdits" | "board" | "archive" };
  messages: unknown[];
  parentSessionStack: ClaudeSession[];
  activeProviders: ProviderInfo["id"][];
  detectProviders: ReturnType<typeof vi.fn>;
  setActiveProviders: ReturnType<typeof vi.fn>;
  loadMetadata: ReturnType<typeof vi.fn>;
  loadServerConfig: ReturnType<typeof vi.fn>;
  exitSessionSelectionMode: ReturnType<typeof vi.fn>;
  selectSession: ReturnType<typeof vi.fn>;
  loadGlobalStats: ReturnType<typeof vi.fn>;
  loadProjectTokenStats: ReturnType<typeof vi.fn>;
  loadSessionTokenStats: ReturnType<typeof vi.fn>;
  loadProjectStatsSummary: ReturnType<typeof vi.fn>;
  setAnalyticsProjectSummary: ReturnType<typeof vi.fn>;
  loadSessionComparison: ReturnType<typeof vi.fn>;
  setAnalyticsSessionComparison: ReturnType<typeof vi.fn>;
  loadRecentEdits: ReturnType<typeof vi.fn>;
  setAnalyticsRecentEdits: ReturnType<typeof vi.fn>;
  loadBoardSessions: ReturnType<typeof vi.fn>;
  loadArchives: ReturnType<typeof vi.fn>;
  clearSessionSearch: ReturnType<typeof vi.fn>;
  clearTokenStats: ReturnType<typeof vi.fn>;
  clearTargetMessage: ReturnType<typeof vi.fn>;
  resetAnalytics: ReturnType<typeof vi.fn>;
  clearBoard: ReturnType<typeof vi.fn>;
  clearRecentEditsDock: ReturnType<typeof vi.fn>;
  setDateFilter: ReturnType<typeof vi.fn>;
};

const createMockProject = (
  name: string,
  provider?: ClaudeProject["provider"],
  lastModified = "2026-01-01T00:00:00.000Z",
): ClaudeProject => ({
  name,
  path: `/sessions/${name}`,
  actual_path: `/workspace/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: lastModified,
  git_info: null,
  ...(provider ? { provider } : {}),
});

const createMockSession = (
  id: string,
  project: ClaudeProject,
): ClaudeSession => ({
  session_id: id,
  actual_session_id: `actual-${id}`,
  file_path: `${project.path}/${id}.jsonl`,
  project_name: project.name,
  message_count: 1,
  first_message_time: "2026-01-01T00:00:00.000Z",
  last_message_time: "2026-01-01T00:00:00.000Z",
  last_modified: "2026-01-01T00:00:00.000Z",
  has_tool_use: false,
  has_errors: false,
  provider: project.provider,
});

const createTestStore = () =>
  create<TestStore>()((set, get) => ({
    providers: [],
    userMetadata: DEFAULT_USER_METADATA,
    updateUserSettings: vi.fn().mockResolvedValue(undefined),
    excludeSidechain: true,
    analytics: { currentView: "messages" },
    messages: [],
    parentSessionStack: [],
    activeProviders: ["claude"],
    detectProviders: vi.fn().mockResolvedValue(true),
    setActiveProviders: vi.fn().mockImplementation((ids: ProviderInfo["id"][]) => {
      set({ activeProviders: ids });
    }),
    loadMetadata: vi.fn().mockResolvedValue(undefined),
    loadServerConfig: vi.fn().mockResolvedValue(undefined),
    // Cross-slice dep added by the multi-select feature: selectProject /
    // clearProjectSelection abandon any in-progress session selection.
    exitSessionSelectionMode: vi.fn(),
    selectSession: vi.fn().mockImplementation(async (session: ClaudeSession) => {
      set({ selectedSession: session });
    }),
    loadGlobalStats: vi.fn().mockResolvedValue(undefined),
    loadProjectTokenStats: vi.fn().mockResolvedValue(undefined),
    loadSessionTokenStats: vi.fn().mockResolvedValue(undefined),
    loadProjectStatsSummary: vi.fn().mockResolvedValue({}),
    setAnalyticsProjectSummary: vi.fn(),
    loadSessionComparison: vi.fn().mockResolvedValue({}),
    setAnalyticsSessionComparison: vi.fn(),
    loadRecentEdits: vi.fn().mockResolvedValue({
      files: [],
      total_edits_count: 0,
      unique_files_count: 0,
      project_cwd: "/workspace",
    }),
    setAnalyticsRecentEdits: vi.fn(),
    loadBoardSessions: vi.fn().mockResolvedValue(undefined),
    loadArchives: vi.fn().mockResolvedValue(undefined),
    clearSessionSearch: vi.fn(),
    clearTokenStats: vi.fn(),
    clearTargetMessage: vi.fn(),
    resetAnalytics: vi.fn(),
    clearBoard: vi.fn(),
    clearRecentEditsDock: vi.fn(),
    setDateFilter: vi.fn(),
    ...createProjectSlice(
      set as Parameters<typeof createProjectSlice>[0],
      get as Parameters<typeof createProjectSlice>[1],
      undefined as never,
    ),
  }));

describe("projectSlice scanProjects", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, "", "/");
  });

  it("clears the WebUI deep link with browser history control", () => {
    window.history.replaceState({}, "", "/?session=session-1&msg=message-1");
    const store = createTestStore();

    store.getState().clearProjectSelection({ history: "replace" });

    const url = new URL(window.location.href);
    expect(url.searchParams.get("session")).toBeNull();
    expect(url.searchParams.get("msg")).toBeNull();
  });

  it("drops the docked Recent Edits rows along with the selection", () => {
    // The dock survives deselection now - it is a workspace fixture, not a
    // property of the selected project - so the rows have to be dropped here.
    // Without this the panel keeps rendering the deselected project's edits.
    const store = createTestStore();

    store.getState().clearProjectSelection();

    expect(store.getState().clearRecentEditsDock).toHaveBeenCalled();
  });

  it("publishes each provider as soon as that provider scan completes", async () => {
    const store = createTestStore();
    const claudeProject = createMockProject(
      "claude-only",
      undefined,
      "2026-01-03T00:00:00.000Z",
    );
    const geminiProject = createMockProject(
      "gemini-project",
      "gemini",
      "2026-01-02T00:00:00.000Z",
    );
    const codexProject = createMockProject(
      "codex-project",
      "codex",
      "2026-01-01T00:00:00.000Z",
    );
    const codexScan = createDeferred<ClaudeProject[]>();
    const geminiScan = createDeferred<ClaudeProject[]>();

    store.setState({
      claudePath: "/root/.claude",
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
        {
          id: "codex",
          display_name: "Codex",
          base_path: "/root/.codex",
          is_available: true,
        },
        {
          id: "gemini",
          display_name: "Gemini CLI",
          base_path: "/root/.gemini",
          is_available: true,
        },
      ],
    });

    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "scan_projects") {
        return Promise.resolve([claudeProject]);
      }
      if (command === "scan_all_projects") {
        const provider = (args?.activeProviders as string[] | undefined)?.[0];
        if (provider === "codex") {
          return codexScan.promise;
        }
        if (provider === "gemini") {
          return geminiScan.promise;
        }
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const scanPromise = store.getState().scanProjects();
    await flushMicrotasks();

    expect(store.getState().isLoadingProjects).toBe(true);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
    ]);

    geminiScan.resolve([geminiProject]);
    await flushMicrotasks();

    expect(store.getState().isLoadingProjects).toBe(true);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
      geminiProject,
    ]);

    codexScan.resolve([codexProject]);
    await scanPromise;

    expect(store.getState().isLoadingProjects).toBe(false);
    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
      geminiProject,
      codexProject,
    ]);
  });

  it("limits the initial scan to Claude before provider discovery is requested", async () => {
    const store = createTestStore();
    const claudeProject = createMockProject("initial-claude");

    store.setState({
      claudePath: "/root/.claude",
      providers: [],
      activeProviders: ["claude"],
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([claudeProject]);
      }
      if (command === "scan_all_projects") {
        return Promise.reject(
          new Error("initial startup must not scan non-Claude providers")
        );
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().scanProjects();

    expect(store.getState().projects).toEqual([
      { ...claudeProject, provider: "claude" },
    ]);
    expect(vi.mocked(api)).toHaveBeenCalledWith("scan_projects", {
      claudePath: "/root/.claude",
    });
    expect(vi.mocked(api)).not.toHaveBeenCalledWith(
      "scan_all_projects",
      expect.anything()
    );
  });

  it("restores explicitly discovered providers when Claude is not installed", async () => {
    const store = createTestStore();
    const codexProject = createMockProject("persisted-codex", "codex");

    store.setState({
      claudePath: "",
      providers: [],
      activeProviders: ["claude"],
      userMetadata: {
        ...DEFAULT_USER_METADATA,
        settings: { discoveredProviderIds: ["codex"] },
      },
    });

    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "get_claude_folder_path") {
        return Promise.reject(new Error("CLAUDE_FOLDER_NOT_FOUND:missing"));
      }
      if (command === "scan_all_projects") {
        expect(args).toEqual({ activeProviders: ["codex"] });
        return Promise.resolve([codexProject]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().initializeApp();

    expect(store.getState().error).toBeNull();
    expect(store.getState().projects).toEqual([codexProject]);
    expect(store.getState().detectProviders).not.toHaveBeenCalled();
    expect(store.getState().setActiveProviders).toHaveBeenCalledWith(["codex"]);
  });

  it("initializes WSL-only sources when native Claude is unavailable", async () => {
    const store = createTestStore();
    const wslProject = createMockProject("wsl-only");

    store.setState({
      claudePath: "",
      providers: [],
      activeProviders: ["claude"],
      userMetadata: {
        ...DEFAULT_USER_METADATA,
        settings: {
          wsl: { enabled: true, excludedDistros: [] },
        },
      },
    });

    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "get_claude_folder_path") {
        return Promise.reject(new Error("CLAUDE_FOLDER_NOT_FOUND:missing"));
      }
      if (command === "scan_all_projects") {
        expect(args).toEqual({
          activeProviders: ["claude"],
          wslEnabled: true,
          wslExcludedDistros: [],
        });
        return Promise.resolve([wslProject]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().initializeApp();

    expect(store.getState().error).toBeNull();
    expect(store.getState().projects).toEqual([
      { ...wslProject, provider: "claude" },
    ]);
    expect(store.getState().detectProviders).not.toHaveBeenCalled();
    expect(
      vi.mocked(api).mock.calls.some(([command]) => command === "scan_projects"),
    ).toBe(false);
  });

  it("persists the provider IDs returned by explicit discovery", async () => {
    const store = createTestStore();
    const codexProject = createMockProject("discovered-codex", "codex");
    const updateUserSettings = vi.fn().mockImplementation(
      async (update: UserMetadata["settings"]) => {
        store.setState({
          userMetadata: {
            ...store.getState().userMetadata,
            settings: {
              ...store.getState().userMetadata.settings,
              ...update,
            },
          },
        });
      }
    );

    store.setState({
      claudePath: "",
      providers: [
        {
          id: "codex",
          display_name: "Codex",
          base_path: "/root/.codex",
          is_available: true,
        },
      ],
      activeProviders: ["codex"],
      updateUserSettings,
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "detect_claude_config_dir") {
        return Promise.resolve(null);
      }
      if (command === "scan_all_projects") {
        return Promise.resolve([codexProject]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().discoverProviders();

    expect(updateUserSettings).toHaveBeenCalledWith({
      discoveredProviderIds: ["codex"],
    });
    expect(store.getState().userMetadata.settings.discoveredProviderIds).toEqual([
      "codex",
    ]);
    expect(store.getState().projects).toEqual([codexProject]);
  });

  it("preserves persisted provider IDs when explicit discovery fails", async () => {
    const store = createTestStore();
    const codexProject = createMockProject("saved-codex", "codex");
    const updateUserSettings = vi.fn();

    store.setState({
      claudePath: "",
      providers: [],
      activeProviders: ["codex"],
      userMetadata: {
        ...DEFAULT_USER_METADATA,
        settings: { discoveredProviderIds: ["codex"] },
      },
      detectProviders: vi.fn().mockResolvedValue(false),
      updateUserSettings,
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_all_projects") {
        return Promise.resolve([codexProject]);
      }
      if (command === "detect_claude_config_dir") {
        return Promise.resolve(null);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().discoverProviders();

    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(store.getState().userMetadata.settings.discoveredProviderIds).toEqual([
      "codex",
    ]);
    expect(store.getState().projects).toEqual([codexProject]);
  });

  it("surfaces provider settings persistence failures", async () => {
    const store = createTestStore();
    const updateUserSettings = vi.fn().mockRejectedValue(new Error("save failed"));

    store.setState({
      claudePath: "",
      providers: [
        {
          id: "codex",
          display_name: "Codex",
          base_path: "/root/.codex",
          is_available: true,
        },
      ],
      activeProviders: ["codex"],
      updateUserSettings,
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "detect_claude_config_dir") {
        return Promise.resolve(null);
      }
      if (command === "scan_all_projects") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().discoverProviders();

    expect(toast.error).toHaveBeenCalledWith(expect.any(String));
  });

  it("reports provider errors when successful scans return no projects", async () => {
    const store = createTestStore();

    store.setState({
      providers: [
        {
          id: "codex",
          display_name: "Codex",
          base_path: "/root/.codex",
          is_available: true,
        },
        {
          id: "gemini",
          display_name: "Gemini CLI",
          base_path: "/root/.gemini",
          is_available: true,
        },
      ],
    });

    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "scan_all_projects") {
        const provider = (args?.activeProviders as string[] | undefined)?.[0];
        if (provider === "codex") {
          return Promise.resolve([]);
        }
        if (provider === "gemini") {
          return Promise.reject(new Error("scan failed"));
        }
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().scanProjects();

    expect(store.getState().projects).toEqual([]);
    expect(store.getState().error).toEqual({
      type: AppErrorType.UNKNOWN,
      message: "gemini: scan failed",
    });
  });

  it("refreshes all conversations and reopens the selected session", async () => {
    const store = createTestStore();
    const project = createMockProject("current", "claude");
    const refreshedProject = {
      ...project,
      session_count: 2,
      last_modified: "2026-01-02T00:00:00.000Z",
    };
    const selectedSession = createMockSession("session-1", project);
    const refreshedSession = {
      ...selectedSession,
      message_count: 3,
      summary: "fresh session",
    };

    store.setState({
      claudePath: "/root/.claude",
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
      ],
      selectedProject: project,
      selectedSession,
      activeProviders: ["claude"],
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([refreshedProject]);
      }
      if (command === "load_provider_sessions_page") {
        return Promise.resolve({
          sessions: [refreshedSession],
          total: 1,
          offset: 0,
          limit: 250,
          nextOffset: 1,
          hasMore: false,
        });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().refreshAllConversations();

    expect(store.getState().detectProviders).not.toHaveBeenCalled();
    expect(store.getState().activeProviders).toEqual(["claude"]);
    expect(store.getState().selectedProject).toEqual(refreshedProject);
    expect(store.getState().sessions).toEqual([refreshedSession]);
    expect(store.getState().selectSession).toHaveBeenCalledWith(refreshedSession);
    expect(store.getState().isRefreshingAllConversations).toBe(false);
  });

  it("keeps the session selected when re-selecting it so the reload is in place (#609)", async () => {
    // selectSession only treats a call as an in-place reload (keeping the
    // subagent stack, pagination and search index) when the same session is
    // still selected. Going through selectProject nulled it first.
    const store = createTestStore();
    const project = createMockProject("current", "claude");
    const selectedSession = createMockSession("session-1", project);
    const refreshedSession = { ...selectedSession, message_count: 3 };
    const selectedAtSelectSession: Array<ClaudeSession | null> = [];
    store.getState().selectSession.mockImplementation(async () => {
      selectedAtSelectSession.push(store.getState().selectedSession);
    });

    store.setState({
      claudePath: "/root/.claude",
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
      ],
      selectedProject: project,
      selectedSession,
      sessions: [selectedSession],
      activeProviders: ["claude"],
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([project]);
      }
      if (command === "load_provider_sessions_page") {
        return Promise.resolve({
          sessions: [refreshedSession],
          total: 1,
          offset: 0,
          limit: 250,
          nextOffset: 1,
          hasMore: false,
        });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().refreshAllConversations();

    expect(store.getState().selectSession).toHaveBeenCalledWith(refreshedSession);
    expect(selectedAtSelectSession).toHaveLength(1);
    expect(selectedAtSelectSession[0]?.file_path).toBe(selectedSession.file_path);
  });

  describe("selected session beyond the first page", () => {
    // The list reloads only page 1. A session the user paged to is looked up
    // on its own instead of being mistaken for a deleted one.
    const project = createMockProject("current", "claude");
    const firstPageSession = createMockSession("session-1", project);
    const pagedSession = createMockSession("session-2", project);
    const refreshedPagedSession = { ...pagedSession, message_count: 7 };
    const firstPage = {
      sessions: [firstPageSession],
      total: 2,
      offset: 0,
      limit: 250,
      nextOffset: 1,
      hasMore: true,
    };

    const setup = (lookup: () => Promise<unknown>) => {
      const store = createTestStore();
      store.setState({
        claudePath: "/root/.claude",
        providers: [
          {
            id: "claude",
            display_name: "Claude Code",
            base_path: "/root/.claude",
            is_available: true,
          },
        ],
        selectedProject: project,
        selectedSession: pagedSession,
        sessions: [firstPageSession, pagedSession],
        sessionsOffset: 2,
        hasMoreSessions: false,
        activeProviders: ["claude"],
      });
      vi.mocked(api).mockImplementation((command, args) => {
        if (command === "scan_projects") {
          return Promise.resolve([project]);
        }
        if (command === "load_provider_sessions_page") {
          const offset = (args as { offset: number }).offset;
          return Promise.resolve(
            offset === 0
              ? firstPage
              : { sessions: [refreshedPagedSession], total: 2, offset: 1, limit: 250, nextOffset: 2, hasMore: false }
          );
        }
        if (command === "load_provider_session_by_path") {
          return lookup();
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      });
      return store;
    };

    it("keeps it selected and listed once when it still exists", async () => {
      const store = setup(() => Promise.resolve(refreshedPagedSession));

      await store.getState().refreshAllConversations();

      expect(api).toHaveBeenCalledWith("load_provider_session_by_path", {
        provider: "claude",
        projectPath: project.path,
        filePath: pagedSession.file_path,
        excludeSidechain: true,
      });
      expect(store.getState().selectSession).toHaveBeenCalledWith(refreshedPagedSession);
      expect(store.getState().selectedSession).toEqual(refreshedPagedSession);
      expect(store.getState().sessions).toEqual([firstPageSession, refreshedPagedSession]);
      // Pagination still continues from page 1.
      expect(store.getState().sessionsOffset).toBe(1);
      expect(store.getState().hasMoreSessions).toBe(true);
    });

    it("does not list it twice when its page is loaded later", async () => {
      const store = setup(() => Promise.resolve(refreshedPagedSession));

      await store.getState().refreshAllConversations();
      await store.getState().loadMoreSessions();

      expect(store.getState().selectedSession).toEqual(refreshedPagedSession);
      expect(store.getState().sessions).toEqual([firstPageSession, refreshedPagedSession]);
      expect(store.getState().hasMoreSessions).toBe(false);
    });

    it("leaves a subagent view alone instead of listing the subagent", async () => {
      // A subagent view selects the subagent's own file (under
      // `<session>/subagents/`), which is never a list row. Looking it up
      // would append it to the sidebar.
      const subagent = {
        ...pagedSession,
        session_id: `${project.path}/session-2/subagents/agent-a.jsonl`,
        file_path: `${project.path}/session-2/subagents/agent-a.jsonl`,
      };
      const store = setup(() => Promise.resolve(subagent));
      store.setState({ selectedSession: subagent, parentSessionStack: [pagedSession] });

      await store.getState().reloadProjectSessions(project);

      expect(api).not.toHaveBeenCalledWith("load_provider_session_by_path", expect.anything());
      expect(store.getState().sessions).toEqual([firstPageSession]);
      expect(store.getState().selectedSession).toBe(subagent);
    });

    it("keeps the row's summary when the lookup has none (empty counts as none)", async () => {
      const store = setup(() => Promise.resolve({ ...refreshedPagedSession, summary: "" }));
      store.setState({ selectedSession: { ...pagedSession, summary: "Borrowed title" } });

      await store.getState().reloadProjectSessions(project);

      expect(store.getState().selectedSession?.summary).toBe("Borrowed title");
      expect(store.getState().sessions[1]?.summary).toBe("Borrowed title");
    });

    it("clears it when its file is gone", async () => {
      const store = setup(() => Promise.resolve(null));

      await store.getState().refreshAllConversations();

      expect(store.getState().selectedSession).toBeNull();
      expect(store.getState().sessions).toEqual([firstPageSession]);
    });
  });

  it("drops a next page requested while a reload is in flight", async () => {
    // A reload keeps the rows on screen and leaves the spinner off, so the
    // list can still ask for the next page at the offset of the OLD list.
    // Appending that page after the reloaded page 1 skips the rows between.
    const project = createMockProject("current", "claude");
    const [s0, s1, s2, s3, s4] = ["s0", "s1", "s2", "s3", "s4"].map((id) =>
      createMockSession(id, project)
    );
    const store = createTestStore();
    store.setState({
      selectedProject: project,
      selectedSession: null,
      sessions: [s1, s2, s3],
      sessionsOffset: 3,
      hasMoreSessions: true,
    });
    const firstPage = createDeferred<unknown>();
    const nextPage = createDeferred<unknown>();
    vi.mocked(api).mockImplementation((command, args) => {
      if (command === "load_provider_sessions_page") {
        return (args as { offset: number }).offset === 0
          ? (firstPage.promise as Promise<never>)
          : (nextPage.promise as Promise<never>);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const reload = store.getState().reloadProjectSessions(project);
    const loadMore = store.getState().loadMoreSessions();
    expect(api).toHaveBeenCalledWith(
      "load_provider_sessions_page",
      expect.objectContaining({ offset: 3 })
    );

    // A new session s0 shifted everything down by one.
    firstPage.resolve({ sessions: [s0, s1], total: 5, offset: 0, limit: 2, nextOffset: 2, hasMore: true });
    await reload;
    nextPage.resolve({ sessions: [s4], total: 5, offset: 3, limit: 2, nextOffset: 4, hasMore: false });
    await loadMore;

    expect(store.getState().sessions).toEqual([s0, s1]);
    expect(store.getState().sessionsOffset).toBe(2);
    expect(store.getState().hasMoreSessions).toBe(true);
    expect(store.getState().isLoadingMoreSessions).toBe(false);
  });

  it("clears stale selection when the selected project no longer exists", async () => {
    const store = createTestStore();
    const project = createMockProject("deleted", "claude");
    const selectedSession = createMockSession("session-1", project);

    store.setState({
      claudePath: "/root/.claude",
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
      ],
      selectedProject: project,
      selectedSession,
      sessions: [selectedSession],
      messages: [{ uuid: "stale" }],
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().refreshAllConversations();

    expect(store.getState().selectedProject).toBeNull();
    expect(store.getState().selectedSession).toBeNull();
    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().isRefreshingAllConversations).toBe(false);
  });

  it("clears stale session when the selected session no longer exists", async () => {
    const store = createTestStore();
    const project = createMockProject("current", "claude");
    const selectedSession = createMockSession("session-1", project);

    store.setState({
      claudePath: "/root/.claude",
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
      ],
      selectedProject: project,
      selectedSession,
      sessions: [selectedSession],
      messages: [{ uuid: "stale" }],
    });

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([project]);
      }
      if (command === "load_provider_sessions_page") {
        return Promise.resolve({
          sessions: [],
          total: 0,
          offset: 0,
          limit: 250,
          nextOffset: 0,
          hasMore: false,
        });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().refreshAllConversations();

    expect(store.getState().selectedProject).toEqual(project);
    expect(store.getState().selectedSession).toBeNull();
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().clearSessionSearch).toHaveBeenCalled();
    expect(store.getState().clearTokenStats).toHaveBeenCalled();
  });

  it("refreshes project-level analytics when no session is selected", async () => {
    const store = createTestStore();
    const project = createMockProject("analytics", "claude");
    const projectSummary = { total_tokens: 123 };

    store.setState({
      claudePath: "/root/.claude",
      analytics: { currentView: "analytics" },
      providers: [
        {
          id: "claude",
          display_name: "Claude Code",
          base_path: "/root/.claude",
          is_available: true,
        },
      ],
      selectedProject: project,
      selectedSession: null,
    });
    store.getState().loadProjectStatsSummary.mockResolvedValue(projectSummary);

    vi.mocked(api).mockImplementation((command) => {
      if (command === "scan_projects") {
        return Promise.resolve([project]);
      }
      if (command === "load_provider_sessions_page") {
        return Promise.resolve({
          sessions: [],
          total: 0,
          offset: 0,
          limit: 250,
          nextOffset: 0,
          hasMore: false,
        });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await store.getState().refreshAllConversations();

    expect(store.getState().loadProjectStatsSummary).toHaveBeenCalledWith(
      project.path
    );
    expect(store.getState().setAnalyticsProjectSummary).toHaveBeenCalledWith(
      projectSummary
    );
    expect(store.getState().setAnalyticsSessionComparison).toHaveBeenCalledWith(
      null
    );
  });
});
