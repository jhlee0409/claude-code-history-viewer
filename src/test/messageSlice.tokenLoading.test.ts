import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type {
  ClaudeProject,
  PaginatedTokenStats,
  ProjectStatsSummary,
  SessionTokenStats,
} from "../types";
import {
  createMessageSlice,
  type MessageSlice,
} from "../store/slices/messageSlice";

const mockFetchSessionTokenStats = vi.fn();
const mockFetchProjectTokenStats = vi.fn();
const mockFetchProjectStatsSummary = vi.fn();

vi.mock("../services/analyticsApi", () => ({
  fetchSessionTokenStats: (...args: unknown[]) =>
    mockFetchSessionTokenStats(...args),
  fetchProjectTokenStats: (...args: unknown[]) =>
    mockFetchProjectTokenStats(...args),
  fetchProjectStatsSummary: (...args: unknown[]) =>
    mockFetchProjectStatsSummary(...args),
  fetchSessionComparison: vi.fn(),
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

const buildSessionStats = (sessionId: string): SessionTokenStats => ({
  session_id: sessionId,
  project_name: "test-project",
  total_input_tokens: 1,
  total_output_tokens: 1,
  total_cache_creation_tokens: 0,
  total_cache_read_tokens: 0,
  total_tokens: 2,
  message_count: 1,
  first_message_time: "2026-01-01T00:00:00.000Z",
  last_message_time: "2026-01-01T00:00:01.000Z",
  most_used_tools: [],
});

const buildProjectStatsResponse = (): PaginatedTokenStats => ({
  items: [buildSessionStats("session-project")],
  total_count: 1,
  offset: 0,
  limit: 20,
  has_more: false,
});

const buildProjectSummary = (): ProjectStatsSummary => ({
  project_name: "test-project",
  total_sessions: 1,
  total_messages: 1,
  total_tokens: 2,
  avg_tokens_per_session: 2,
  avg_session_duration: 1,
  total_session_duration: 1,
  most_active_hour: 0,
  most_used_tools: [],
  daily_stats: [],
  activity_heatmap: [],
  token_distribution: {
    input: 1,
    output: 1,
    cache_creation: 0,
    cache_read: 0,
  },
});

type TestStore = MessageSlice & {
  dateFilter: { start: Date | null; end: Date | null };
  setError: ReturnType<typeof vi.fn>;
  selectedProject: ClaudeProject | null;
};

const createTestStore = () => {
  const setError = vi.fn();
  return create<TestStore>()((set, get) => ({
    dateFilter: { start: null, end: null },
    setError,
    selectedProject: null,
    ...createMessageSlice(
      set as Parameters<typeof createMessageSlice>[0],
      get as Parameters<typeof createMessageSlice>[1]
    ),
  }));
};

describe("messageSlice token loading state", () => {
  beforeEach(() => {
    mockFetchProjectTokenStats.mockReset();
    mockFetchSessionTokenStats.mockReset();
    mockFetchProjectStatsSummary.mockReset();
    mockFetchProjectStatsSummary.mockResolvedValue(buildProjectSummary());
  });

  it("keeps loading true until both token stats requests complete", async () => {
    const useStore = createTestStore();
    const projectDeferred = createDeferred<PaginatedTokenStats>();
    const sessionDeferred = createDeferred<SessionTokenStats>();

    mockFetchProjectTokenStats.mockReturnValue(projectDeferred.promise);
    mockFetchSessionTokenStats.mockReturnValue(sessionDeferred.promise);

    const projectPromise = useStore.getState().loadProjectTokenStats("/project");
    const sessionPromise = useStore.getState().loadSessionTokenStats("/session");

    expect(useStore.getState().isLoadingTokenStats).toBe(true);

    sessionDeferred.resolve(buildSessionStats("session-single"));
    await sessionPromise;
    expect(useStore.getState().isLoadingTokenStats).toBe(true);

    projectDeferred.resolve(buildProjectStatsResponse());
    await projectPromise;
    expect(useStore.getState().isLoadingTokenStats).toBe(false);
  });

  it("clearTokenStats stops loading and ignores stale completions", async () => {
    const useStore = createTestStore();
    const sessionDeferred = createDeferred<SessionTokenStats>();

    mockFetchSessionTokenStats.mockReturnValue(sessionDeferred.promise);

    const sessionPromise = useStore.getState().loadSessionTokenStats("/session");
    expect(useStore.getState().isLoadingTokenStats).toBe(true);

    useStore.getState().clearTokenStats();
    expect(useStore.getState().isLoadingTokenStats).toBe(false);

    sessionDeferred.resolve(buildSessionStats("session-stale"));
    await sessionPromise;

    expect(useStore.getState().isLoadingTokenStats).toBe(false);
  });

  it("reuses billing stats as conversation stats for providers without sidechain metadata", async () => {
    const useStore = createTestStore();
    useStore.setState({
      selectedProject: {
        name: "codex-project",
        path: "codex://project",
        actual_path: "/tmp/codex-project",
        session_count: 0,
        message_count: 0,
        last_modified: "2026-01-01T00:00:00.000Z",
        provider: "codex",
      },
    });

    const billingStats = buildSessionStats("session-codex");
    mockFetchSessionTokenStats.mockResolvedValue(billingStats);

    await useStore.getState().loadSessionTokenStats("/session-codex");

    expect(mockFetchSessionTokenStats).toHaveBeenCalledTimes(1);
    expect(mockFetchSessionTokenStats).toHaveBeenCalledWith(
      "/session-codex",
      "billing_total"
    );
    expect(useStore.getState().sessionTokenStats).toEqual(billingStats);
    expect(useStore.getState().sessionConversationTokenStats).toEqual(
      billingStats
    );
  });
});
