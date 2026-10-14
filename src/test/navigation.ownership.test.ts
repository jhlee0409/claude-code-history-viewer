/**
 * Ownership of asynchronous work (plan §4.2), ported from the independent T2
 * review's adversarial probes (scratch/t2-review).
 *
 * The rule under test: every write that lands after an await checks that it
 * still owns what it writes. Data checks its request identity (the latest
 * request of its kind, for the context it was loaded for); anything that
 * changes what the user sees beyond that data - the global error, the URL,
 * the message target, the place itself - also checks that no navigation has
 * begun since the work started (`placeOwner`). Reloads take that ownership
 * without advancing the epoch, so they never supersede a navigation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { act, renderHook } from "@testing-library/react";
import { useAppStore } from "@/store/useAppStore";
import { useAnalyticsNavigation } from "@/hooks/analytics/useAnalyticsNavigation";
import type { ProjectStatsSummary } from "@/types";
import type { BoardSessionData } from "@/types/board.types";
import { openBoardMessage } from "@/components/SessionBoard/openBoardMessage";

const project = (name: string): ClaudeProject => ({
  name,
  path: `/p/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
});
const sessionOf = (p: ClaudeProject, id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `${p.path}/${id}.jsonl`,
  project_name: p.name,
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
});

const A = project("a");
const B = project("b");
const A1 = sessionOf(A, "a1");
const A2 = sessionOf(A, "a2");
const B1 = sessionOf(B, "b1");
const LISTS: Record<string, ClaudeSession[]> = { [A.path]: [A1, A2], [B.path]: [B1] };
const message = (uuid: string) => ({ uuid, type: "user", content: uuid }) as ClaudeMessage;
const page = (uuid = "loaded"): MessagePage => ({
  messages: [message(uuid)],
  total_count: 1,
  has_more: false,
  next_offset: 1,
});

/** A promise the test settles by hand. */
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
/** Per-test command overrides; everything else answers from the fixtures. */
let overrides: Record<string, (args: Record<string, unknown>) => unknown>;

beforeEach(() => {
  overrides = {};
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    const override = overrides[command];
    if (override) return override(args);
    if (command === "scan_projects" || command === "scan_all_projects") return [A, B];
    if (command === "load_provider_sessions_page") {
      const sessions = LISTS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    if (command === "load_provider_session_by_path") return null;
    if (command === "load_provider_messages_paginated") return page();
    if (command === "get_session_subagents") return [];
    if (command === "get_project_stats_summary") {
      return { total_sessions: args.projectPath === A.path ? 11 : 22 };
    }
    return null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
  window.history.replaceState({}, "", "/");
});

afterEach(() => vi.restoreAllMocks());

describe("a superseded navigation's loads do not take over the new screen", () => {
  it("a late session-load failure does not raise a global error over Settings", async () => {
    await state().navigate({ project: A, session: A1 });
    const load = gate<MessagePage>();
    overrides.load_provider_messages_paginated = () => load.promise;

    const opening = state().navigate({ session: A2 });
    await state().navigate({ view: "settingsManager" });
    load.reject(new Error("obsolete A2 failure"));

    expect(await opening).toBe(false);
    expect(state().error).toBeNull();
    expect(state().view).toBe("settingsManager");
    // The load itself is finished, so nothing is left spinning.
    expect(state().isLoadingMessages).toBe(false);
  });

  it("a late project-load failure does not raise a global error over Settings", async () => {
    const load = gate<unknown>();
    overrides.load_provider_sessions_page = () => load.promise;

    const opening = state().navigate({ project: A });
    await state().navigate({ view: "settingsManager" });
    load.reject(new Error("obsolete A project failure"));

    expect(await opening).toBe(false);
    expect(state().error).toBeNull();
    expect(state().isLoadingSessions).toBe(false);
  });

  it("a late token-stats failure does not raise a global error after the user moved on", async () => {
    await state().navigate({ project: A, session: A1, view: "tokenStats" });
    const load = gate<unknown>();
    overrides.get_session_token_stats = () => load.promise;

    const loading = state().loadSessionTokenStats(A1.file_path);
    await state().navigate({ view: "settingsManager" });
    load.reject(new Error("obsolete token stats failure"));
    await loading;

    expect(state().error).toBeNull();
  });

  it("a failure of the navigation still in charge is still reported", async () => {
    await state().navigate({ project: A, session: A1 });
    overrides.load_provider_messages_paginated = () => {
      throw new Error("A2 is unreadable");
    };

    expect(await state().navigate({ session: A2 })).toBe(true);
    expect(state().error?.message).toBe("A2 is unreadable");
  });
});

describe("the WebUI URL follows the place even when a navigation is cancelled", () => {
  const urlSession = () => new URL(window.location.href).searchParams.get("session");

  it("a cancelled project navigation does not leave the previous session in the URL", async () => {
    await state().navigate({ project: A, session: A1 });
    expect(urlSession()).toBe("a1");
    const load = gate<unknown>();
    overrides.load_provider_sessions_page = () => load.promise;

    const opening = state().navigate({ project: B });
    await state().navigate({ view: "globalStats" });
    load.resolve({ sessions: [B1], total: 1, nextOffset: 1, hasMore: false });

    expect(await opening).toBe(false);
    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().selectedSession).toBeNull();
    expect(urlSession()).toBeNull();
  });

  it("opening another project's session still adds exactly one URL entry", async () => {
    await state().navigate({ project: A, session: A1 });
    const push = vi.spyOn(window.history, "pushState");

    await state().navigate({ project: B, session: B1 });

    expect(push).toHaveBeenCalledTimes(1);
    expect(urlSession()).toBe("b1");
  });
});

describe("the header refresh is a reload: it never moves the user", () => {
  it("a refresh started on A does not take the user back to A after they opened B", async () => {
    await state().navigate({ project: A, session: A1 });
    const scan = gate<ClaudeProject[]>();
    overrides.scan_projects = () => scan.promise;

    const refresh = state().refreshAllConversations();
    await state().navigate({ project: B, session: B1 });
    scan.resolve([A, B]);
    await refresh;

    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().selectedSession?.file_path).toBe(B1.file_path);
    expect(state().sessions.map((s) => s.file_path)).toEqual([B1.file_path]);
  });

  it("a refresh whose old project vanished does not clear the place the user moved to", async () => {
    await state().navigate({ project: A, session: A1 });
    const scan = gate<ClaudeProject[]>();
    overrides.scan_projects = () => scan.promise;

    const refresh = state().refreshAllConversations();
    await state().navigate({ project: B, session: B1 });
    scan.resolve([B]);
    await refresh;

    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().selectedSession?.file_path).toBe(B1.file_path);
  });

  it("a refresh whose session list lands after the user moved does not drop the new session", async () => {
    await state().navigate({ project: A, session: A1 });
    const list = gate<unknown>();
    let held = false;
    overrides.load_provider_sessions_page = (args) => {
      if (args.projectPath === A.path && !held) {
        held = true;
        return list.promise;
      }
      const sessions = LISTS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    };

    const refresh = state().refreshAllConversations();
    await vi.waitFor(() => expect(held).toBe(true));
    await state().navigate({ project: B, session: B1 });
    // A's list without A1: had the refresh carried on, it would clear "A1".
    list.resolve({ sessions: [A2], total: 1, nextOffset: 1, hasMore: false });
    await refresh;

    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().selectedSession?.file_path).toBe(B1.file_path);
    expect(state().sessions.map((s) => s.file_path)).toEqual([B1.file_path]);
  });

  it("a session-list reload of a project that is no longer open does not select it", async () => {
    await state().navigate({ project: B, session: B1 });

    await state().reloadProjectSessions(A);

    expect(state().selectedProject?.path).toBe(B.path);
    expect(state().sessions.map((s) => s.file_path)).toEqual([B1.file_path]);
  });

  it("a refresh with nobody moving still reloads the open place", async () => {
    await state().navigate({ project: A, session: A1 });
    const epoch = state().navigationEpoch;

    await state().refreshAllConversations();

    expect(state().navigationEpoch).toBe(epoch);
    expect(state().selectedProject?.path).toBe(A.path);
    expect(state().selectedSession?.file_path).toBe(A1.file_path);
  });
});

describe("screen data belongs to the navigation that asked for it", () => {
  it("a slower A analytics load does not overwrite B's analytics while B is open", async () => {
    await state().navigate({ project: A });
    const slowA = gate<ProjectStatsSummary>();
    overrides.get_project_stats_summary = (args) =>
      args.projectPath === A.path ? slowA.promise : { total_sessions: 22 };
    const { result } = renderHook(() => useAnalyticsNavigation());

    let pendingA!: Promise<void>;
    act(() => {
      pendingA = result.current.switchToAnalytics();
    });
    await act(async () => {
      await state().navigate({ project: B, view: "analytics" });
    });
    await act(async () => {
      await result.current.switchToAnalytics();
    });
    expect(state().analytics.projectSummary?.total_sessions).toBe(22);

    slowA.resolve({ total_sessions: 11 } as ProjectStatsSummary);
    await act(async () => {
      await pendingA;
    });

    expect(state().analytics.projectSummary?.total_sessions).toBe(22);
    expect(state().analytics.projectConversationSummary?.total_sessions).toBe(22);
    expect(state().analytics.isLoadingProjectSummary).toBe(false);
  });

  it("a slower A analytics failure reports nothing while B's analytics is open", async () => {
    await state().navigate({ project: A });
    const slowA = gate<ProjectStatsSummary>();
    overrides.get_project_stats_summary = (args) =>
      args.projectPath === A.path ? slowA.promise : { total_sessions: 22 };
    const { result } = renderHook(() => useAnalyticsNavigation());

    let pendingA!: Promise<void>;
    act(() => {
      pendingA = result.current.switchToAnalytics();
    });
    await act(async () => {
      await state().navigate({ project: B, view: "analytics" });
      await result.current.switchToAnalytics();
    });

    slowA.reject(new Error("obsolete A summary failure"));
    await act(async () => {
      await pendingA.catch(() => {});
    });

    expect(state().analytics.projectSummaryError).toBeNull();
    expect(state().error).toBeNull();
    expect(state().analytics.projectSummary?.total_sessions).toBe(22);
  });

  it("a slower board load for A does not replace B's board", async () => {
    await state().navigate({ project: A, view: "board" });
    const slowA = gate<ClaudeMessage[]>();
    overrides.get_git_log = () => [];
    overrides.load_provider_messages = (args) =>
      String(args.sessionPath).startsWith(A.path) ? slowA.promise : [message("b-msg")];

    const loadingA = state().loadBoardSessions(LISTS[A.path]!);
    await state().navigate({ project: B, view: "board" });
    await state().loadBoardSessions(LISTS[B.path]!);
    expect(Object.keys(state().boardSessions)).toEqual(["b1"]);

    slowA.resolve([message("a-msg")]);
    await loadingA;

    expect(Object.keys(state().boardSessions)).toEqual(["b1"]);
    expect(state().isLoadingBoard).toBe(false);
  });
});

describe("refreshing a screen is a reload, not a navigation", () => {
  it("refreshAnalytics reloads the open analytics without advancing the epoch", async () => {
    await state().navigate({ project: A, view: "analytics" });
    const { result } = renderHook(() => useAnalyticsNavigation());
    const epoch = state().navigationEpoch;
    const historyBefore = state().placeHistory;

    await act(async () => {
      await result.current.refreshAnalytics();
    });

    expect(state().navigationEpoch).toBe(epoch);
    expect(state().placeHistory).toBe(historyBefore);
    expect(state().analytics.projectSummary?.total_sessions).toBe(11);
  });

  it("refreshAnalytics on token stats, edits and board does not advance the epoch either", async () => {
    overrides.get_git_log = () => [];
    overrides.load_provider_messages = () => [];
    overrides.get_recent_edits = () => ({
      files: [],
      total_edits_count: 0,
      unique_files_count: 0,
      project_cwd: A.actual_path,
      offset: 0,
      limit: 20,
      has_more: false,
    });
    const { result } = renderHook(() => useAnalyticsNavigation());
    for (const view of ["tokenStats", "edits", "board"] as const) {
      await state().navigate({ project: A, view });
      const epoch = state().navigationEpoch;
      await act(async () => {
        await result.current.refreshAnalytics();
      });
      expect(state().navigationEpoch, view).toBe(epoch);
      expect(state().view, view).toBe(view);
    }
  });
});

describe("an explicit message target belongs to its session", () => {
  const urlMessage = () => new URL(window.location.href).searchParams.get("msg");

  it("Back to a place without a target clears a later target and its msg URL", async () => {
    await state().navigate({ project: A, session: A1 });
    await state().navigate({ view: "analytics", messageId: "later-message" });
    expect(urlMessage()).toBe("later-message");
    const { result } = renderHook(() => useAnalyticsNavigation());

    await act(async () => {
      await result.current.goBack();
    });

    expect(state().view).toBe("conversation");
    expect(state().selectedSession?.file_path).toBe(A1.file_path);
    expect(state().targetMessageUuid).toBeNull();
    expect(urlMessage()).toBeNull();
  });

  it("opening another session with messageId null drops the old session's target", async () => {
    await state().navigate({ project: A, session: A1, messageId: "only-in-A1" });

    await state().navigate({ session: A2, messageId: null });

    expect(state().targetMessageUuid).toBeNull();
    expect(urlMessage()).toBeNull();
  });

  it("opening another session without a target does not inherit the old one", async () => {
    await state().navigate({ project: A, session: A1, messageId: "only-in-A1" });

    await state().navigate({ session: A2 });

    expect(state().targetMessageUuid).toBeNull();
    expect(urlMessage()).toBeNull();
  });

  it("a screen switch that names no target keeps the current one", async () => {
    await state().navigate({ project: A, session: A1, messageId: "kept" });

    await state().navigate({ view: "analytics" });
    await state().navigate({ view: "conversation" });

    expect(state().targetMessageUuid).toBe("kept");
    expect(urlMessage()).toBe("kept");
  });
});

describe("opening a message from the board is one navigation", () => {
  const boardData = (session: ClaudeSession, uuids: string[]) =>
    ({ session, messages: uuids.map(message) }) as unknown as BoardSessionData;

  it("records the board with the session it had, then opens the lane's session from its cache", async () => {
    await state().navigate({ project: A, session: A1 });
    await state().navigate({ view: "board" });
    apiMock.mockClear();

    await openBoardMessage(boardData(A2, ["A2-first", "A2-board-cache"]), "A2-board-cache");

    const outgoing = state().placeHistory.back.at(-1);
    expect(outgoing?.view).toBe("board");
    expect(outgoing?.session?.file_path).toBe(A1.file_path);
    expect(state().view).toBe("conversation");
    expect(state().selectedSession?.file_path).toBe(A2.file_path);
    expect(state().messages.map((m) => m.uuid)).toEqual(["A2-first", "A2-board-cache"]);
    expect(state().targetMessageUuid).toBe("A2-board-cache");
    // The board already holds the whole session: no page is fetched.
    expect(apiMock).not.toHaveBeenCalledWith(
      "load_provider_messages_paginated",
      expect.anything(),
    );
  });

  it("Back from the opened message returns to the board with its original session", async () => {
    await state().navigate({ project: A, session: A1 });
    await state().navigate({ view: "board" });
    await openBoardMessage(boardData(A2, ["A2-board-cache"]), "A2-board-cache");
    const { result } = renderHook(() => useAnalyticsNavigation());
    overrides.get_git_log = () => [];
    overrides.load_provider_messages = () => [];

    await act(async () => {
      await result.current.goBack();
    });

    expect(state().view).toBe("board");
    expect(state().selectedSession?.file_path).toBe(A1.file_path);
  });

  it("a message in the session already open only moves the screen and the target", async () => {
    await state().navigate({ project: A, session: A1 });
    await state().navigate({ view: "board" });
    const messagesBefore = state().messages;

    await openBoardMessage(boardData(A1, ["from-board"]), "loaded");

    expect(state().view).toBe("conversation");
    expect(state().messages).toBe(messagesBefore);
    expect(state().targetMessageUuid).toBe("loaded");
  });
});
