import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
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
  activeProviders: ProviderInfo["id"][];
  detectProviders: ReturnType<typeof vi.fn>;
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
    activeProviders: ["claude"],
    detectProviders: vi.fn().mockResolvedValue(undefined),
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
