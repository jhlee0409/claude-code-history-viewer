import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { GlobalStatsSummary, ProviderId } from "../types";
import {
  createGlobalStatsSlice,
  type GlobalStatsSlice,
} from "../store/slices/globalStatsSlice";

const mockFetchGlobalStatsSummary = vi.fn();

vi.mock("../services/analyticsApi", () => ({
  fetchGlobalStatsSummary: (...args: unknown[]) =>
    mockFetchGlobalStatsSummary(...args),
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

const buildGlobalSummary = (): GlobalStatsSummary => ({
  total_projects: 1,
  total_sessions: 1,
  total_messages: 1,
  total_tokens: 2,
  total_session_duration_minutes: 1,
  date_range: {
    first_message: "2026-01-01T00:00:00.000Z",
    last_message: "2026-01-01T00:00:01.000Z",
    days_span: 1,
  },
  token_distribution: {
    input: 1,
    output: 1,
    cache_creation: 0,
    cache_read: 0,
  },
  daily_stats: [],
  activity_heatmap: [],
  most_used_tools: [],
  model_distribution: [],
  top_projects: [],
});

type TestStore = GlobalStatsSlice & {
  claudePath: string;
  activeProviders: ProviderId[];
  setError: ReturnType<typeof vi.fn>;
};

const createTestStore = () => {
  const setError = vi.fn();
  return create<TestStore>()((set, get) => ({
    claudePath: "/tmp/claude",
    activeProviders: ["claude"],
    setError,
    ...createGlobalStatsSlice(
      set as Parameters<typeof createGlobalStatsSlice>[0],
      get as Parameters<typeof createGlobalStatsSlice>[1]
    ),
  }));
};

describe("globalStatsSlice", () => {
  beforeEach(() => {
    mockFetchGlobalStatsSummary.mockReset();
  });

  it("clearGlobalStats resets loading and blocks stale response overwrite", async () => {
    const useStore = createTestStore();
    const deferred = createDeferred<GlobalStatsSummary>();
    mockFetchGlobalStatsSummary.mockReturnValue(deferred.promise);

    const loadPromise = useStore.getState().loadGlobalStats();
    expect(useStore.getState().isLoadingGlobalStats).toBe(true);

    useStore.getState().clearGlobalStats();
    expect(useStore.getState().isLoadingGlobalStats).toBe(false);
    expect(useStore.getState().globalSummary).toBeNull();

    deferred.resolve(buildGlobalSummary());
    await loadPromise;

    expect(useStore.getState().isLoadingGlobalStats).toBe(false);
    expect(useStore.getState().globalSummary).toBeNull();
  });
});
