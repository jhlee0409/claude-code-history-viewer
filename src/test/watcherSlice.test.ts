import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { create } from "zustand";
import {
  createWatcherSlice,
  type WatcherSlice,
} from "../store/slices/watcherSlice";
import { AppErrorType, type ClaudeSession } from "../types";

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
  messages: unknown[];
  selectSession: ReturnType<typeof vi.fn>;
  selectProject: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  invalidateRecentEdits: Mock;
  reloadProjectSessions: Mock;
};

const createTestStore = () =>
  create<TestStore>()((set, get) => ({
    selectedSession,
    selectedProject: null,
    messages: [],
    selectSession: vi.fn().mockResolvedValue(undefined),
    selectProject: vi.fn().mockResolvedValue(undefined),
    invalidateRecentEdits: vi.fn(),
    reloadProjectSessions: vi.fn().mockResolvedValue(undefined),
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

  it("defers active-session refresh while the user is reading away from the bottom", async () => {
    const store = createTestStore();
    store.setState({ messages: [{}] });
    store.getState().setActiveSessionNearBottom(false);

    void store
      .getState()
      .triggerSessionRefresh("/project", selectedSession.file_path);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    expect(store.getState().selectSession).not.toHaveBeenCalled();
    expect(Object.keys(store.getState().lastUpdateTime)).toEqual(["/project"]);

    store.getState().setActiveSessionNearBottom(true);

    await vi.advanceTimersByTimeAsync(1499);
    await flushMicrotasks();
    expect(store.getState().selectSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    expect(store.getState().selectSession).toHaveBeenCalledTimes(1);
  });

  it("cancels an already scheduled refresh when the user scrolls away from the bottom", async () => {
    const store = createTestStore();
    store.setState({ messages: [{}] });

    void store
      .getState()
      .triggerSessionRefresh("/project", selectedSession.file_path);

    await vi.advanceTimersByTimeAsync(500);
    store.getState().setActiveSessionNearBottom(false);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    expect(store.getState().selectSession).not.toHaveBeenCalled();

    store.getState().setActiveSessionNearBottom(true);

    await vi.advanceTimersByTimeAsync(1499);
    await flushMicrotasks();
    expect(store.getState().selectSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();

    expect(store.getState().selectSession).toHaveBeenCalledTimes(1);
  });

  it("surfaces selected-session refresh failures from the timer callback", async () => {
    const store = createTestStore();
    store
      .getState()
      .selectSession.mockRejectedValueOnce(new Error("load failed"));

    void store
      .getState()
      .triggerSessionRefresh("/project", selectedSession.file_path);

    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();

    expect(store.getState().setError).toHaveBeenCalledWith({
      type: AppErrorType.UNKNOWN,
      message: "Failed to refresh session: Error: load failed",
    });
  });
});

describe("watcherSlice recent-edits invalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates the Recent Edits cache for the project that changed", async () => {
    // `selectProject` reloads the session list and never touches analytics, so
    // this is the only place a file write can reach the cache. Without it the
    // panel serves pre-edit rows for as long as the project stays selected.
    const store = createTestStore();
    store.setState({ selectedProject: { path: "/project" } });

    await store.getState().triggerProjectRefresh("/project");

    expect(store.getState().invalidateRecentEdits).toHaveBeenCalledWith(
      "/project"
    );
  });

  it("invalidates even when the changed project is not the selected one", async () => {
    // The cache is keyed by the path it was fetched for, not by the current
    // selection, so an entry can outlive its project being deselected and be
    // served again on the way back.
    const store = createTestStore();
    store.setState({ selectedProject: { path: "/other" } });

    await store.getState().triggerProjectRefresh("/project");

    expect(store.getState().invalidateRecentEdits).toHaveBeenCalledWith(
      "/project"
    );
    expect(store.getState().selectProject).not.toHaveBeenCalled();
  });
});

describe("watcherSlice wildcard events", () => {
  // OpenCode stores sessions in SQLite, so the backend watcher cannot attribute
  // a write to one project/session and emits `opencode://*` instead. Strict
  // equality against the selection dropped every such event, leaving the WebUI
  // frozen until a manual refresh (#566).
  const opencodeSession: ClaudeSession = {
    ...selectedSession,
    file_path: "opencode://hash/session-id",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the selected OpenCode session and its project list", async () => {
    const store = createTestStore();
    store.setState({
      selectedSession: opencodeSession,
      selectedProject: { path: "opencode://hash" },
    });

    void store
      .getState()
      .triggerSessionRefresh("opencode://*", "opencode://*");

    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();

    expect(store.getState().reloadProjectSessions).toHaveBeenCalledWith({
      path: "opencode://hash",
    });
    expect(store.getState().selectSession).toHaveBeenCalledWith(
      opencodeSession
    );
    expect(Object.keys(store.getState().lastUpdateTime)).toEqual([
      "opencode://hash",
    ]);
  });

  it("ignores a wildcard from another provider", async () => {
    const store = createTestStore();
    store.setState({
      selectedSession: opencodeSession,
      selectedProject: { path: "opencode://hash" },
    });

    void store.getState().triggerSessionRefresh("codex://*", "codex://*");

    await vi.advanceTimersByTimeAsync(2000);
    await flushMicrotasks();

    expect(store.getState().selectSession).not.toHaveBeenCalled();
    expect(store.getState().reloadProjectSessions).not.toHaveBeenCalled();
  });
});
