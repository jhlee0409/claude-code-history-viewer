/**
 * #508. While a session is open, any write to its `.jsonl` dropped the app back
 * to the "select a session" empty state, so a session Claude Code was still
 * writing to could not be watched at all.
 *
 * The two slices are wired together here rather than mocked, because the bug
 * lives exactly in the seam: `watcherSlice` asks `projectSlice` to reload a
 * project, and `selectProject` is written for "the user picked a different
 * project" and clears the selection on the way. Mocking `selectProject`, as
 * `watcherSlice.test.ts` does, makes the bug invisible.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { api } from "../services/api";
import { createWatcherSlice } from "../store/slices/watcherSlice";
import { createProjectSlice } from "../store/slices/projectSlice";
import type { FullAppStore } from "../store/slices/types";
import type { ClaudeProject, ClaudeSession } from "../types";

vi.mock("../services/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const PROJECT: ClaudeProject = {
  name: "my-app",
  path: "/Users/alex/.claude/projects/-Users-alex-my-app",
  actual_path: "/Users/alex/my-app",
  session_count: 1,
  message_count: 2,
  last_modified: "2026-08-19T00:00:00.000Z",
};

const SESSION: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/Users/alex/.claude/projects/-Users-alex-my-app/s1.jsonl",
  project_name: "my-app",
  message_count: 2,
  first_message_time: "2026-08-19T00:00:00.000Z",
  last_message_time: "2026-08-19T00:00:01.000Z",
  last_modified: "2026-08-19T00:00:01.000Z",
  has_tool_use: false,
  has_errors: false,
};

const mockedApi = vi.mocked(api);

/**
 * Only the two slices under test, plus the handful of members they reach for on
 * the wider store. Building the whole app store would drag in every other
 * slice's initialisation for no benefit here.
 */
const createStore = () =>
  create<FullAppStore>()((set, get, store) => ({
    ...createProjectSlice(set, get, store),
    ...createWatcherSlice(set, get, store),
    // Reached by the refresh path; irrelevant to what is asserted, but they
    // have to be present or `scheduleSessionRefresh` throws on `messages`
    // before the session half of the refresh ever runs, which would leave the
    // 1500ms restore path untested while the assertions still passed.
    messages: [],
    activeSessionNearBottom: true,
    analytics: { currentView: "messages", recentEdits: null, recentEditsGeneration: 0 },
    selectSession: vi.fn().mockResolvedValue(undefined),
    invalidateRecentEdits: vi.fn(),
    clearSessionSearch: vi.fn(),
    clearTokenStats: vi.fn(),
    clearTargetMessage: vi.fn(),
    exitSessionSelectionMode: vi.fn(),
    setError: vi.fn(),
  }) as unknown as FullAppStore);

describe("#508 a file write must not clear the open session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedApi.mockReset();
    // Every backend call the reload path makes returns the same one-session page.
    mockedApi.mockImplementation(async (command: string) => {
      if (command === "load_provider_sessions_page") {
        return { sessions: [SESSION], total: 1, nextOffset: 1, hasMore: false };
      }
      if (command === "load_session_messages_paginated") {
        return { messages: [], total: 0, nextOffset: 0, hasMore: false };
      }
      return null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the session selected across a watcher-driven project reload", async () => {
    const store = createStore();
    store.setState({ selectedProject: PROJECT, selectedSession: SESSION });

    void store.getState().triggerSessionRefresh(PROJECT.path, SESSION.file_path);

    // The project reload fires at 250ms; the session refresh that would restore
    // the selection is on a 1500ms quiet period, so the gap between them is
    // where the empty state used to appear. Land inside it deliberately.
    await vi.advanceTimersByTimeAsync(400);

    expect(store.getState().selectedSession?.file_path).toBe(SESSION.file_path);
  });

  it("still has the session selected once everything settles", async () => {
    const store = createStore();
    store.setState({ selectedProject: PROJECT, selectedSession: SESSION });

    void store.getState().triggerSessionRefresh(PROJECT.path, SESSION.file_path);
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.getState().selectedSession?.file_path).toBe(SESSION.file_path);
  });

  it("still clears the selection when the user picks a different project", async () => {
    // The nulling in `selectProject` is correct for its own case, and the fix
    // must not take it away: switching projects has to drop a session that
    // belongs to the project being left.
    const store = createStore();
    store.setState({ selectedProject: PROJECT, selectedSession: SESSION });

    await store.getState().selectProject({ ...PROJECT, path: "/other", name: "other" });

    expect(store.getState().selectedSession).toBeNull();
  });
});

/**
 * #508, second half. The watcher's project reload blanked the session list
 * before refetching it, so the sidebar emptied and refilled on every tick.
 * Measured against the running app: a single write took the list from 18 rows
 * to 1 and back within 29ms, and a session Claude Code is actively writing
 * produces a tick at least every 250ms.
 *
 * That is also what defeated the "don't refresh while the user has scrolled up"
 * deferral: the deferral guards the session refresh, but the project reload
 * fired regardless and churned the sidebar underneath the reader. Rather than
 * plumb the deferral through — which would hide genuinely new sessions from
 * someone mid-read — the reload is simply no longer disruptive.
 */
describe("#508 a watcher reload must not blank the session list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedApi.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Holds the session page open so mid-flight state can be observed. */
  const deferredPage = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockedApi.mockImplementation(async (command: string) => {
      if (command === "load_provider_sessions_page") {
        await gate;
        return { sessions: [SESSION], total: 1, nextOffset: 1, hasMore: false };
      }
      return null;
    });
    return { release: () => release() };
  };

  it("keeps the rows on screen while the new page is in flight", async () => {
    const store = createStore();
    store.setState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      sessions: [SESSION],
    });

    const { release } = deferredPage();
    const pending = store.getState().reloadProjectSessions(PROJECT);

    // Mid-flight: this is the window the sidebar used to render empty in.
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().isLoadingSessions).toBe(false);

    release();
    await pending;
    expect(store.getState().sessions).toHaveLength(1);
  });

  it("still raises the spinner when there is genuinely nothing to show", async () => {
    // The flag means "the user has nothing to look at yet", so an empty list
    // must still get one. Suppressing it unconditionally would trade a flash
    // for a dead-looking sidebar on first load.
    const store = createStore();
    store.setState({ selectedProject: PROJECT, sessions: [] });

    const { release } = deferredPage();
    const pending = store.getState().reloadProjectSessions(PROJECT);

    expect(store.getState().isLoadingSessions).toBe(true);

    release();
    await pending;
    expect(store.getState().isLoadingSessions).toBe(false);
  });

  it("still clears the outgoing project's rows when switching projects", async () => {
    // The clear moved into `selectProject`; it must not have been lost. The
    // previous project's sessions must never render under the new project's
    // name.
    const store = createStore();
    store.setState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      sessions: [SESSION],
    });

    const { release } = deferredPage();
    const pending = store
      .getState()
      .selectProject({ ...PROJECT, path: "/other", name: "other" });

    expect(store.getState().sessions).toHaveLength(0);
    expect(store.getState().selectedSession).toBeNull();

    release();
    await pending;
  });
});
