/**
 * WebUI browser history written by one navigation (plan §4.2, review-2 R5).
 *
 * A move is one history step: the first URL write that actually changes the
 * URL uses the navigation's mode, and every later write of the same move
 * refines that entry. Whether an entry is added therefore depends on whether
 * the URL changes, never on an intermediate write that turned out to be a
 * no-op (clearing the session from a URL that had none).
 *
 * Every case below matches the behaviour at 13f394c8 (before the T2 fixes),
 * except "A1 -> B1 cancelled during B's project load", which that commit got
 * wrong (the outgoing session stayed in the URL) and is pinned separately in
 * navigation.ownership.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

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

const page = (): MessagePage => ({
  messages: [{ uuid: "m1", type: "user", content: "m1" } as ClaudeMessage],
  total_count: 1,
  has_more: false,
  next_offset: 1,
});

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();

/** The browser history this test can observe: entries added and replaced. */
function watchHistory() {
  const push = vi.spyOn(window.history, "pushState");
  const replace = vi.spyOn(window.history, "replaceState");
  const lengthBefore = window.history.length;
  return {
    get pushed() {
      return push.mock.calls.length;
    },
    get replaced() {
      return replace.mock.calls.length;
    },
    get added() {
      return window.history.length - lengthBefore;
    },
  };
}
const search = () => window.location.search;

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "load_provider_sessions_page") {
      const sessions = LISTS[String(args.projectPath)] ?? [];
      return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
    }
    if (cmd === "load_provider_messages_paginated") return page();
    if (cmd === "get_session_subagents") return [];
    return null;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ projects: [A, B] });
  window.history.replaceState({}, "", "/");
});
afterEach(() => vi.restoreAllMocks());

describe("one navigation, one history step", () => {
  it("session-less URL -> open a session: pushes one entry", async () => {
    const history = watchHistory();
    await state().navigate({ project: A, session: A1 });
    expect(search()).toBe("?session=a1");
    expect(history.pushed).toBe(1);
    expect(history.added).toBe(1);
  });

  it("project only -> another project's session: pushes one entry", async () => {
    await state().navigate({ project: A });
    const history = watchHistory();
    await state().navigate({ project: B, session: B1 });
    expect(search()).toBe("?session=b1");
    expect(history.pushed).toBe(1);
    expect(history.added).toBe(1);
  });

  it("session A1 -> session A2 (same project): pushes one entry", async () => {
    await state().navigate({ project: A, session: A1 });
    const history = watchHistory();
    await state().navigate({ session: A2 });
    expect(search()).toBe("?session=a2");
    expect(history.pushed).toBe(1);
    expect(history.added).toBe(1);
  });

  it("session A1 -> session B1 (another project): one entry, refined in place", async () => {
    await state().navigate({ project: A, session: A1 });
    const history = watchHistory();
    await state().navigate({ project: B, session: B1 });
    expect(search()).toBe("?session=b1");
    expect(history.added).toBe(1);
  });

  it("session -> another session at a message: one entry carrying the message", async () => {
    await state().navigate({ project: A, session: A1 });
    const history = watchHistory();
    await state().navigate({ session: A2, messageId: "m1" });
    expect(search()).toBe("?session=a2&msg=m1");
    expect(history.pushed).toBe(1);
    expect(history.added).toBe(1);
  });

  it("popstate (history none): no history writes at all", async () => {
    await state().navigate({ project: A, session: A1 });
    window.history.replaceState({}, "", "/?session=a2");
    const history = watchHistory();
    await state().navigate({ session: A2 }, { history: "none", record: false });
    expect(search()).toBe("?session=a2");
    expect(history.pushed).toBe(0);
    expect(history.replaced).toBe(0);
    expect(history.added).toBe(0);
  });

  it("reload of the open session: no history writes at all", async () => {
    await state().navigate({ project: A, session: A1 });
    const history = watchHistory();
    await state().reloadCurrent("watcher");
    expect(search()).toBe("?session=a1");
    expect(history.pushed).toBe(0);
    expect(history.replaced).toBe(0);
  });

  it("deleting the open session: replaces the entry, adds none", async () => {
    await state().navigate({ project: A, session: A1 });
    const history = watchHistory();
    await state().navigate({ session: null }, { record: false, history: "replace" });
    expect(search()).toBe("");
    expect(history.pushed).toBe(0);
    expect(history.replaced).toBe(1);
    expect(history.added).toBe(0);
  });

  it("a screen switch within the session: no history writes", async () => {
    await state().navigate({ project: A, session: A1 });
    const history = watchHistory();
    await state().navigate({ view: "analytics" });
    expect(history.pushed).toBe(0);
    expect(history.replaced).toBe(0);
  });
});
