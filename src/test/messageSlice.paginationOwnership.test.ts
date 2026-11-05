import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ClaudeMessage, ClaudeSession, MessagePage } from "../types";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("../utils/platform", async (importOriginal) => ({
  ...await importOriginal<typeof import("../utils/platform")>(),
  isTauri: () => false,
  getApiBase: () => "http://fixture.local",
}));

const session = (id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `/fixture/${id}.jsonl`,
  project_name: "fixture",
  provider: "claude",
  message_count: 1000,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
});
const SESSION = session("current");
const OTHER = session("successor");
const records = (target: ClaudeSession): ClaudeMessage[] =>
  Array.from({ length: target.message_count }, (_, i) => ({
    uuid: `${target.session_id}-${i}`,
    sessionId: target.session_id,
    role: "user",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: `message ${i}`,
  }));
const fixtures = new Map([SESSION, OTHER].map((s) => [s.file_path, records(s)]));
type PageArgs = { sessionPath: string; offset: number; limit: number };
const pageFor = (args: PageArgs): MessagePage => {
  const all = fixtures.get(args.sessionPath)!;
  const end = all.length - args.offset;
  const start = Math.max(0, end - args.limit);
  return { messages: all.slice(start, end), next_offset: all.length - start,
    total_count: all.length, has_more: start > 0 };
};

/** The real combined store, including navigation and document-unavailable cleanup. */
const createAppStore = async () => (await import("../store/useAppStore")).useAppStore;

function transport() {
  const requests: { args: PageArgs; reply: (code?: number) => void }[] = [];
  let inFlight = 0;
  const completed: number[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith("/get_session_subagents")) {
      return Promise.resolve(new Response("[]"));
    }
    expect(url).toBe("http://fixture.local/api/load_provider_messages_paginated");
    const args = JSON.parse(init.body as string) as PageArgs;
    inFlight++;
    return new Promise<Response>((resolve) => {
      requests.push({ args, reply: (code = 200) => {
        inFlight--;
        completed.push(code);
        resolve(new Response(JSON.stringify(code === 200 ? pageFor(args) : { error: "controlled reload failure" }), { status: code }));
      } });
    });
  }));
  return { requests, completed, get inFlight() { return inFlight; } };
}

describe("pagination request ownership in the real app store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function prepare() {
    const http = transport();
    const store = await createAppStore();
    const open = store.getState().navigate({ session: SESSION });
    await vi.waitFor(() => expect(http.requests).toHaveLength(1));
    http.requests[0]!.reply();
    await open;
    const more = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(2));
    http.requests[1]!.reply();
    await more;
    expect(store.getState().messages).toEqual(fixtures.get(SESSION.file_path)!.slice(-400));
    return { http, store };
  }

  it("releases inherited paging after a navigation-superseded reload HTTP 500 and can page again", async () => {
    const { http, store } = await prepare();
    const before = store.getState();
    const older = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(3));
    expect(http.requests[2]!.args.offset).toBe(400);
    const reload = store.getState().reloadCurrent("watcher");
    await vi.waitFor(() => expect(http.requests).toHaveLength(4));
    expect(http.requests[3]!.args).toMatchObject({ offset: 0, limit: 400 });
    http.requests[2]!.reply();
    await older;
    expect(store.getState().pagination.isLoadingMore).toBe(true);
    await store.getState().navigate({ view: "conversation" });
    expect(store.getState().navigationEpoch).toBeGreaterThan(before.navigationEpoch);
    http.requests[3]!.reply(500);
    await reload;
    expect(http.completed).toEqual([200, 200, 200, 500]);
    expect(http.inFlight).toBe(0);
    expect(store.getState().messages).toBe(before.messages);
    expect(store.getState().selectedSession).toEqual(SESSION);
    expect(store.getState().error).toBe(before.error);
    expect(toast.error).not.toHaveBeenCalled();
    expect(store.getState().pagination).toEqual({ ...before.pagination, isLoadingMore: false });

    const next = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(5));
    expect(http.requests[4]!.args.offset).toBe(400);
    http.requests[4]!.reply();
    await next;
    expect(store.getState().messages).toEqual(fixtures.get(SESSION.file_path)!.slice(-600));
    expect(store.getState().pagination.currentOffset).toBe(600);
    expect(store.getState().pagination.isLoadingMore).toBe(false);
    expect(http.inFlight).toBe(0);
  });

  it.each([200, 500])("a stale older HTTP %i cannot change the reload's data or spinner", async (code) => {
    const { http, store } = await prepare();
    const before = store.getState();
    const older = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(3));
    const reload = store.getState().reloadCurrent("watcher");
    await vi.waitFor(() => expect(http.requests).toHaveLength(4));
    http.requests[2]!.reply(code);
    await older;
    expect(store.getState().messages).toBe(before.messages);
    expect(store.getState().pagination).toEqual({ ...before.pagination, isLoadingMore: true });
    expect(store.getState().selectedSession).toEqual(SESSION);
    expect(toast.error).not.toHaveBeenCalled();
    expect(http.inFlight).toBe(1);
    http.requests[3]!.reply();
    await reload;
    expect(store.getState().messages).toEqual(before.messages);
    expect(store.getState().pagination).toEqual(before.pagination);
    expect(http.inFlight).toBe(0);
  });

  it.each([200, 500])("a stale reload HTTP %i cannot unlock a replacement reload sharing its pagination", async (code) => {
    const { http, store } = await prepare();
    const older = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(3));
    const first = store.getState().reloadCurrent("watcher");
    await vi.waitFor(() => expect(http.requests).toHaveLength(4));
    const replacement = store.getState().reloadCurrent("filter");
    await vi.waitFor(() => expect(http.requests).toHaveLength(5));
    const inherited = store.getState().pagination;
    const messages = store.getState().messages;
    http.requests[2]!.reply();
    await older;
    http.requests[3]!.reply(code);
    await first;
    expect(store.getState().pagination).toBe(inherited);
    expect(inherited.isLoadingMore).toBe(true);
    expect(store.getState().messages).toBe(messages);
    expect(store.getState().selectedSession).toEqual(SESSION);
    expect(toast.error).not.toHaveBeenCalled();
    http.requests[4]!.reply();
    await replacement;
    expect(store.getState().pagination.isLoadingMore).toBe(false);
    expect(store.getState().messages).toEqual(messages);
    expect(http.inFlight).toBe(0);
  });

  it.each([
    [200, false], [500, false], [200, true], [500, true],
  ] as const)("stale reload HTTP %i protects a successor page (new session: %s)", async (code, newSession) => {
    const { http, store } = await prepare();
    const first = store.getState().reloadCurrent("watcher");
    await vi.waitFor(() => expect(http.requests).toHaveLength(3));
    const replace = newSession
      ? store.getState().navigate({ session: OTHER })
      : store.getState().reloadCurrent("filter");
    await vi.waitFor(() => expect(http.requests).toHaveLength(4));
    http.requests[3]!.reply();
    await replace;
    const successor = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(5));
    const before = store.getState();
    http.requests[2]!.reply(code);
    await first;
    expect(store.getState().pagination).toBe(before.pagination);
    expect(store.getState().pagination.isLoadingMore).toBe(true);
    expect(store.getState().messages).toBe(before.messages);
    expect(store.getState().selectedSession).toEqual(newSession ? OTHER : SESSION);
    expect(store.getState().error).toBe(before.error);
    expect(toast.error).not.toHaveBeenCalled();
    expect(http.inFlight).toBe(1);
    const expected = pageFor(http.requests[4]!.args);
    http.requests[4]!.reply();
    await successor;
    expect(store.getState().messages).toEqual([...expected.messages, ...before.messages]);
    expect(store.getState().pagination.currentOffset).toBe(expected.next_offset);
    expect(store.getState().pagination.isLoadingMore).toBe(false);
    expect(http.inFlight).toBe(0);
  });

  it("does not stop a page begun during the same reload generation", async () => {
    const { http, store } = await prepare();
    const reload = store.getState().reloadCurrent("watcher");
    await vi.waitFor(() => expect(http.requests).toHaveLength(3));
    const older = store.getState().loadMoreMessages();
    await vi.waitFor(() => expect(http.requests).toHaveLength(4));
    await store.getState().navigate({ view: "conversation" });
    const before = store.getState();
    http.requests[2]!.reply(500);
    await reload;
    expect(store.getState().pagination).toBe(before.pagination);
    expect(store.getState().pagination.isLoadingMore).toBe(true);
    expect(store.getState().messages).toBe(before.messages);
    expect(toast.error).not.toHaveBeenCalled();
    http.requests[3]!.reply();
    await older;
    expect(store.getState().pagination.currentOffset).toBe(600);
    expect(store.getState().pagination.isLoadingMore).toBe(false);
    expect(http.inFlight).toBe(0);
  });

  it("keeps the real document-unavailable cleanup for a current reload error", async () => {
    const { http, store } = await prepare();
    const reload = store.getState().reloadCurrent("watcher");
    await vi.waitFor(() => expect(http.requests).toHaveLength(3));
    http.requests[2]!.reply(500);
    await reload;
    expect(store.getState().selectedSession).toBeNull();
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().pagination).toMatchObject({ currentOffset: 0, hasMore: false, isLoadingMore: false });
    expect(store.getState().isLoadingMessages).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(http.inFlight).toBe(0);
  });
});
