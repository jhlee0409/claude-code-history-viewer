import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import {
  createWatcherSlice,
  type WatcherSlice,
} from "../store/slices/watcherSlice";
import type { ClaudeSession } from "../types";

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const selectedSession: ClaudeSession = {
  session_id: "session-id",
  actual_session_id: "actual-session-id",
  file_path: "/tmp/session.jsonl",
  project_name: "project",
  message_count: 1,
  first_message_time: "2026-06-13T00:00:00Z",
  last_message_time: "2026-06-13T00:00:00Z",
  last_modified: "2026-06-13T00:00:00Z",
  has_tool_use: false,
  has_errors: false,
};

type TestStore = WatcherSlice & {
  selectedSession: ClaudeSession | null;
  selectedProject: { path: string } | null;
  selectSession: ReturnType<typeof vi.fn>;
  selectProject: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
};

const createTestStore = () =>
  create<TestStore>()((set, get) => ({
    selectedSession,
    selectedProject: null,
    selectSession: vi.fn().mockResolvedValue(undefined),
    selectProject: vi.fn().mockResolvedValue(undefined),
    setError: vi.fn(),
    ...createWatcherSlice(
      set as Parameters<typeof createWatcherSlice>[0],
      get as Parameters<typeof createWatcherSlice>[1],
      undefined as never
    ),
  }));

describe("watcherSlice refresh coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a quiet period before refreshing the selected session", async () => {
    const store = createTestStore();

    void store
      .getState()
      .triggerSessionRefresh("/project", selectedSession.file_path);

    await vi.advanceTimersByTimeAsync(1499);
    await flushMicrotasks();
    expect(store.getState().selectSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    expect(store.getState().selectSession).toHaveBeenCalledTimes(1);
  });

  it("keeps deferring selected-session refresh until events go quiet", async () => {
    const store = createTestStore();

    void store
      .getState()
      .triggerSessionRefresh("/project", selectedSession.file_path);

    for (let i = 0; i < 15; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      void store
        .getState()
        .triggerSessionRefresh("/project", selectedSession.file_path);
    }

    await vi.advanceTimersByTimeAsync(1499);
    await flushMicrotasks();

    expect(store.getState().selectSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    expect(store.getState().selectSession).toHaveBeenCalledTimes(1);
  });

  it("throttles project update markers for unrelated session events", async () => {
    const store = createTestStore();

    for (let i = 0; i < 50; i += 1) {
      void store.getState().triggerSessionRefresh("/project", `/tmp/${i}.jsonl`);
    }

    expect(store.getState().lastUpdateTime).toEqual({});

    await vi.advanceTimersByTimeAsync(249);
    expect(store.getState().lastUpdateTime).toEqual({});

    await vi.advanceTimersByTimeAsync(1);
    expect(Object.keys(store.getState().lastUpdateTime)).toEqual(["/project"]);
    expect(store.getState().selectSession).not.toHaveBeenCalled();
  });
});
