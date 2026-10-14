/**
 * One ownership rule for every async write (plan §4.2, `src/navigation/ownership.ts`):
 *
 * - feedback (global error, toast, warning) and URL / target writes: only
 *   while no navigation has begun since the work started AND the project /
 *   session it was asked for is still the open one;
 * - data: only the latest request of its kind, for the context it was asked
 *   for;
 * - spinners: cleared by the request that raised them, unless a newer request
 *   of the same kind has taken the spinner over.
 *
 * Ported from the second independent T2 review's supplemental probes
 * (scratch/t2-review/review-2.md R1-R4, R6); each failed at e7646271.
 * The subagent request-identity cases come from the third review
 * (scratch/t2-review/review-3.md R1); each failed at 08a2a4e3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";

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
const page = (): MessagePage => ({
  messages: [message("loaded")],
  total_count: 2,
  has_more: true,
  next_offset: 1,
});

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
let overrides: Record<string, (args: Record<string, unknown>) => unknown>;

beforeEach(() => {
  overrides = {};
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  vi.mocked(toast.info).mockClear();
  apiMock.mockReset();
  apiMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (overrides[cmd]) return overrides[cmd](args);
    if (cmd === "scan_projects" || cmd === "scan_all_projects") return [A, B];
    if (cmd === "load_provider_sessions_page") {
      const sessions = LISTS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    if (cmd === "load_provider_session_by_path") return null;
    if (cmd === "load_provider_messages_paginated") return page();
    if (cmd === "get_session_subagents" || cmd === "get_git_log") return [];
    if (cmd === "get_session_token_stats") {
      return { session_id: String(args.sessionPath).includes("b1") ? "b1" : "a1" };
    }
    if (cmd === "get_project_token_stats") {
      return { items: [], total_count: 0, offset: 0, limit: 20, has_more: false };
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

describe("feedback is owned by place and context (R1, R6)", () => {
  it("a refresh scan failing after the user moved to Settings raises no global error", async () => {
    await state().navigate({ project: A, session: A1 });
    const scan = gate<ClaudeProject[]>();
    overrides.scan_projects = () => scan.promise;
    const refresh = state().refreshAllConversations();
    await state().navigate({ view: "settingsManager" });
    scan.reject(new Error("obsolete refresh scan failure"));
    await refresh;
    expect(state().view).toBe("settingsManager");
    expect(state().isRefreshingAllConversations).toBe(false);
    expect(state().isLoadingProjects).toBe(false);
    expect(state().error).toBeNull();
  });

  it("a scan failure with no navigation since still reports its error", async () => {
    overrides.scan_projects = () => Promise.reject(new Error("scan failed"));
    await state().scanProjects();
    expect(state().error?.message).toContain("scan failed");
  });

  it("a same-session offset failure after a screen switch does not toast", async () => {
    await state().navigate({ project: A, session: A1 });
    const locate = gate<number>();
    overrides.get_provider_message_offset = () => locate.promise;
    const locating = state().ensureMessageLoaded("old-target");
    await state().navigate({ view: "settingsManager" });
    locate.reject(new Error("obsolete same-session offset failure"));
    expect(await locating).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a conversation-only token fallback after a screen switch does not warn", async () => {
    await state().navigate({ project: A, session: A1 });
    const token = gate<unknown>();
    overrides.get_session_token_stats = (args) =>
      args.statsMode === "conversation_only" ? token.promise : { session_id: "a1" };
    const loading = state().loadSessionTokenStats(A1.file_path);
    await state().navigate({ view: "settingsManager" });
    token.reject(new Error("obsolete conversation stats failure"));
    await loading;
    expect(state().isLoadingTokenStats).toBe(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a subagent failure after a screen switch does not warn", async () => {
    await state().navigate({ project: A, session: A1 });
    const agents = gate<never>();
    overrides.get_session_subagents = () => agents.promise;
    const loading = state().loadSubagents(A1.file_path, []);
    await state().navigate({ view: "settingsManager" });
    agents.reject(new Error("obsolete subagent failure"));
    await loading;
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a subagent failure with no navigation since still warns", async () => {
    await state().navigate({ project: A, session: A1 });
    overrides.get_session_subagents = () => Promise.reject(new Error("subagents failed"));
    await state().loadSubagents(A1.file_path, []);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe("spinners are cleared by the request that raised them (R2)", () => {
  it("a message load abandoned for a project-only move does not strand the spinner", async () => {
    await state().navigate({ project: A, session: A1 });
    const load = gate<MessagePage>();
    overrides.load_provider_messages_paginated = () => load.promise;
    const opening = state().navigate({ session: A2 });
    await state().navigate({ project: B });
    load.resolve(page());
    expect(await opening).toBe(false);
    expect(state().selectedSession).toBeNull();
    expect(state().isLoadingMessages).toBe(false);
  });

  it("an older message load never clears a newer load's spinner", async () => {
    await state().navigate({ project: A, session: A1 });
    const first = gate<MessagePage>();
    const second = gate<MessagePage>();
    const loads = [first, second];
    overrides.load_provider_messages_paginated = () => loads.shift()!.promise;
    const openingA2 = state().navigate({ session: A2 });
    const openingA1 = state().navigate({ session: A1 });
    first.resolve(page());
    await openingA2;
    expect(state().isLoadingMessages).toBe(true);
    second.resolve(page());
    await openingA1;
    expect(state().isLoadingMessages).toBe(false);
  });

  it("an older-page load abandoned for a project-only move does not strand its flag", async () => {
    await state().navigate({ project: A, session: A1 });
    const older = gate<MessagePage>();
    overrides.load_provider_messages_paginated = () => older.promise;
    const loading = state().loadMoreMessages();
    await vi.waitFor(() => expect(state().pagination.isLoadingMore).toBe(true));
    await state().navigate({ project: B });
    older.resolve(page());
    await loading;
    expect(state().pagination.isLoadingMore).toBe(false);
  });

  it("an in-session search abandoned by a session switch does not strand its spinner", async () => {
    await state().navigate({ project: A, session: A1 });
    const full = gate<ClaudeMessage[]>();
    overrides.load_provider_messages = () => full.promise;
    const searching = state().setSessionSearchQuery("loaded");
    expect(state().sessionSearch.isSearching).toBe(true);
    await state().navigate({ session: A2 });
    full.resolve([message("loaded")]);
    await searching;
    expect(state().sessionSearch.isSearching).toBe(false);
  });
});

describe("message target follows the selection atomically (R4)", () => {
  it("a cancelled session navigation drops the outgoing session's target", async () => {
    await state().navigate({ project: A, session: A1, messageId: "only-in-A1" });
    const load = gate<MessagePage>();
    overrides.load_provider_messages_paginated = () => load.promise;
    const opening = state().navigate({ session: A2 });
    await state().navigate({ view: "settingsManager" });
    load.resolve(page());
    expect(await opening).toBe(false);
    expect(state().selectedSession?.file_path).toBe(A2.file_path);
    expect(state().targetMessageUuid).toBeNull();
  });
});

describe("token data is owned by the context it was asked for (R3)", () => {
  it("A's session token stats do not land after moving to B without another request", async () => {
    await state().navigate({ project: A, session: A1 });
    const token = gate<unknown>();
    overrides.get_session_token_stats = () => token.promise;
    const loading = state().loadSessionTokenStats(A1.file_path);
    await state().navigate({ project: B, session: B1 });
    token.resolve({ session_id: "a1" });
    await loading;
    expect(state().sessionTokenStats?.session_id).not.toBe("a1");
    expect(state().isLoadingTokenStats).toBe(false);
  });

  it("A's project token stats do not land after moving to B without another request", async () => {
    await state().navigate({ project: A, session: A1 });
    const token = gate<unknown>();
    overrides.get_project_token_stats = () => token.promise;
    const loading = state().loadProjectTokenStats(A.path);
    await state().navigate({ project: B, session: B1 });
    token.resolve({
      items: [{ session_id: "a1" }],
      total_count: 1,
      offset: 0,
      limit: 20,
      has_more: false,
    });
    await loading;
    expect(state().projectTokenStats.map((row) => row.session_id)).not.toContain("a1");
    expect(state().isLoadingTokenStats).toBe(false);
  });

  it("same-context token stats still land after a screen-only move (cache warming)", async () => {
    await state().navigate({ project: A, session: A1 });
    const token = gate<unknown>();
    overrides.get_session_token_stats = () => token.promise;
    const loading = state().loadSessionTokenStats(A1.file_path);
    await state().navigate({ view: "settingsManager" });
    token.resolve({ session_id: "a1" });
    await loading;
    expect(state().sessionTokenStats?.session_id).toBe("a1");
  });
});

describe("subagent data is owned by the latest request of the session (review-3 R1)", () => {
  const agent = {
    agent_id: "new",
    file_path: "/p/a/subagents/agent-new.jsonl",
    tool_use_id: "new-tool",
    message_count: 1,
  };

  it("an older same-session failure does not erase the newer request's subagents", async () => {
    await state().navigate({ project: A, session: A1 });
    const old = gate<unknown[]>();
    const next = gate<unknown[]>();
    let n = 0;
    overrides.get_session_subagents = () => (++n === 1 ? old.promise : next.promise);
    const first = state().loadSubagents(A1.file_path, []);
    const second = state().loadSubagents(A1.file_path, []);
    next.resolve([agent]);
    await second;
    old.reject(new Error("stale subagent error"));
    await first;
    expect(state().subagentSessions).toEqual([agent]);
    expect(state().toolUseToSubagentMap.get("new-tool")).toBe(agent.file_path);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("an older reload's subagent list does not replace the newer reload's", async () => {
    await state().navigate({ project: A, session: A1 });
    let reload = 0;
    overrides.load_provider_messages_paginated = () => ({
      ...page(),
      messages: [message(`reload-${++reload}`)],
    });
    const old = gate<unknown[]>();
    const next = gate<unknown[]>();
    const pending = [old, next];
    overrides.get_session_subagents = () => pending.shift()!.promise;
    await state().reloadCurrent("watcher");
    await state().reloadCurrent("watcher");
    expect(pending).toHaveLength(0);
    next.resolve([agent]);
    await vi.waitFor(() => expect(state().subagentSessions).toEqual([agent]));
    old.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state().subagentSessions).toEqual([agent]);
    expect(state().toolUseToSubagentMap.get("new-tool")).toBe(agent.file_path);
  });

  it("a new session load supersedes the outstanding subagent request", async () => {
    await state().navigate({ project: A, session: A1 });
    const stale = gate<unknown[]>();
    overrides.get_session_subagents = () => stale.promise;
    const staleLoad = state().loadSubagents(A1.file_path, []);
    const held = gate<MessagePage>();
    overrides.load_provider_messages_paginated = () => held.promise;
    const toA2 = state().navigate({ session: A2 });
    const backToA1 = state().navigate({ session: A1 });
    await vi.waitFor(() => {
      expect(state().selectedSession?.file_path).toBe(A1.file_path);
      expect(state().isLoadingMessages).toBe(true);
    });
    stale.resolve([agent]);
    await staleLoad;
    expect(state().subagentSessions).toEqual([]);
    held.resolve(page());
    await Promise.all([toA2, backToA1]);
  });
});
