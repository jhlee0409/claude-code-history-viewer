import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { PaginatedTokenStats, SessionTokenStats } from "../types";
import {
  createMessageSlice,
  type MessageSlice,
} from "../store/slices/messageSlice";

const mockFetchSessionTokenStats = vi.fn();
const mockFetchProjectTokenStats = vi.fn();

vi.mock("../services/analyticsApi", () => ({
  fetchSessionTokenStats: (...args: unknown[]) =>
    mockFetchSessionTokenStats(...args),
  fetchProjectTokenStats: (...args: unknown[]) =>
    mockFetchProjectTokenStats(...args),
  fetchProjectStatsSummary: vi.fn(),
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

type TestStore = MessageSlice & {
  dateFilter: { start: Date | null; end: Date | null };
  setError: ReturnType<typeof vi.fn>;
};

const createTestStore = () => {
  const setError = vi.fn();
  return create<TestStore>()((set, get) => ({
    dateFilter: { start: null, end: null },
    setError,
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
});
