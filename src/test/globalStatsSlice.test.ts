import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { GlobalStatsSummary, ProviderId, DateFilter } from "../types";
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
  provider_distribution: [],
  model_distribution: [],
  top_projects: [],
});

type TestStore = GlobalStatsSlice & {
  claudePath: string;
  activeProviders: ProviderId[];
  dateFilter: DateFilter;
  setError: ReturnType<typeof vi.fn>;
};

const createTestStore = () => {
  const setError = vi.fn();
  return create<TestStore>()((set, get) => ({
    claudePath: "/tmp/claude",
    activeProviders: ["claude"],
    dateFilter: { start: null, end: null },
    setError,
    ...createGlobalStatsSlice(
      set as Parameters<typeof createGlobalStatsSlice>[0],
      get as Parameters<typeof createGlobalStatsSlice>[1]
    ),
  }));
};

describe("globalStatsSlice", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetchGlobalStatsSummary.mockReset();
    consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
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

  it("skips conversation-only request when selected providers do not support breakdown", async () => {
    const useStore = createTestStore();
    const summary = buildGlobalSummary();
    useStore.setState({ activeProviders: ["codex"] });
    mockFetchGlobalStatsSummary.mockResolvedValue(summary);

    await useStore.getState().loadGlobalStats();

    expect(mockFetchGlobalStatsSummary).toHaveBeenCalledTimes(1);
    expect(mockFetchGlobalStatsSummary).toHaveBeenCalledWith(
      "/tmp/claude",
      "billing_total",
      ["codex"],
      undefined,
      undefined,
    );
    expect(useStore.getState().globalSummary).toEqual(summary);
    // No conversation breakdown for codex → conversation summary falls back to billing.
    expect(useStore.getState().globalConversationSummary).toEqual(summary);
  });

  it("keeps billing summary when conversation-only request fails", async () => {
    const useStore = createTestStore();
    const summary = buildGlobalSummary();
    mockFetchGlobalStatsSummary
      .mockResolvedValueOnce(summary)
      .mockRejectedValueOnce(new Error("conversation fetch failed"));

    await useStore.getState().loadGlobalStats();

    expect(mockFetchGlobalStatsSummary).toHaveBeenCalledTimes(2);
    expect(useStore.getState().globalSummary).toEqual(summary);
    // Conversation failure → null (no implicit fallback to billing)
    expect(useStore.getState().globalConversationSummary).toBeNull();
    expect(useStore.getState().setError).toHaveBeenCalledWith(null);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("expands end date to end-of-day when forwarding date filter", async () => {
    const useStore = createTestStore();
    const summary = buildGlobalSummary();
    const start = new Date(2026, 0, 10);
    const end = new Date(2026, 0, 12);
    const expectedEnd = new Date(end);
    expectedEnd.setHours(23, 59, 59, 999);

    useStore.setState({ dateFilter: { start, end } });
    mockFetchGlobalStatsSummary
      .mockResolvedValueOnce(summary)
      .mockResolvedValueOnce(summary);

    await useStore.getState().loadGlobalStats();

    expect(mockFetchGlobalStatsSummary).toHaveBeenNthCalledWith(
      1,
      "/tmp/claude",
      "billing_total",
      ["claude"],
      start.toISOString(),
      expectedEnd.toISOString(),
    );
    expect(mockFetchGlobalStatsSummary).toHaveBeenNthCalledWith(
      2,
      "/tmp/claude",
      "conversation_only",
      ["claude"],
      start.toISOString(),
      expectedEnd.toISOString(),
    );
  });
});
