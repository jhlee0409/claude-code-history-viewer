/**
 * Tests for chat-style message pagination in messageSlice.
 *
 * - selectSession loads only the newest window (limit = MESSAGE_PAGE_SIZE)
 * - loadMoreMessages prepends the older page and dedups overlap
 * - in-place reload preserves the already-paged-in window span
 * - ensureMessageLoaded extends the window to cover a deep-linked uuid
 * - fetchFullSessionMessages returns the complete session and caches per key
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { groupTurns } from "../components/MessageNavigator/outline/groupTurns";
import { getFilteredClassifiedMessages } from "../components/MessageNavigator/classifiedRows";
import { buildTranscriptItems } from "../components/transcript/transcriptItems";
import { flattened, tool, user } from "../components/transcript/transcriptItems.fixtures";
import type {
  ClaudeMessage,
  ClaudeSession,
  ProjectStatsSummary,
} from "../types";
import {
  createMessageSlice,
  MESSAGE_PAGE_SIZE,
  type MessageSlice,
} from "../store/slices/messageSlice";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApi = vi.fn();
vi.mock("@/services/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    warning: vi.fn(),
  },
}));

vi.mock("../utils/searchIndex", () => ({
  buildSearchIndex: vi.fn(),
  clearSearchIndex: vi.fn(),
}));

vi.mock("../services/analyticsApi", () => ({
  fetchSessionTokenStats: vi.fn(),
  fetchProjectTokenStats: vi.fn(),
  fetchProjectStatsSummary: vi
    .fn()
    .mockResolvedValue({} as ProjectStatsSummary),
  fetchSessionComparison: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test store + fixtures
// ---------------------------------------------------------------------------

type TestStore = MessageSlice & {
  selectedSession: ClaudeSession | null;
  excludeSidechain: boolean;
  showSystemMessages: boolean;
  setError: ReturnType<typeof vi.fn>;
  setSelectedSession: (s: ClaudeSession | null) => void;
  resetMessageFilter: () => void;
  selectedProject: null;
  dateFilter: { start: null; end: null };
};

const createTestStore = () =>
  create<TestStore>()((set, get) => ({
    selectedSession: null,
    excludeSidechain: true,
    showSystemMessages: false,
    setError: vi.fn(),
    setSelectedSession: (s) => set({ selectedSession: s }),
    resetMessageFilter: vi.fn(),
    selectedProject: null,
    dateFilter: { start: null, end: null },
    ...createMessageSlice(
      set as Parameters<typeof createMessageSlice>[0],
      get as Parameters<typeof createMessageSlice>[1],
    ),
  }));

const makeSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession =>
  ({
    session_id: "session-1",
    actual_session_id: "session-1",
    file_path: "/tmp/session.jsonl",
    project_name: "proj",
    message_count: 0,
    first_message_time: "",
    last_message_time: "",
    last_modified: "",
    has_tool_use: false,
    has_errors: false,
    summary: "",
    ...overrides,
  }) as ClaudeSession;

const makeMessage = (uuid: string): ClaudeMessage =>
  ({
    uuid,
    session_id: "session-1",
    timestamp: "2026-07-12T00:00:00Z",
    type: "user",
    content: `content-${uuid}`,
  }) as unknown as ClaudeMessage;

/** A fake backing store of N chronological messages (uuid-1 .. uuid-N). */
const makeBackend = (total: number) => {
  const all = Array.from({ length: total }, (_, i) =>
    makeMessage(`uuid-${i + 1}`),
  );
  const page = (args: { offset?: number; limit?: number }) => {
    const offset = args.offset ?? 0;
    const limit = args.limit ?? total;
    const remaining = Math.max(total - offset, 0);
    const toLoad = Math.min(limit, remaining);
    const start = remaining - toLoad;
    return {
      messages: all.slice(start, remaining),
      total_count: total,
      has_more: start > 0,
      next_offset: offset + toLoad,
    };
  };
  return { all, page };
};

const installBackend = (backend: ReturnType<typeof makeBackend>) => {
  mockApi.mockImplementation(
    (
      cmd: string,
      args: { offset?: number; limit?: number; messageUuid?: string },
    ) => {
      if (cmd === "load_provider_messages_paginated") {
        return Promise.resolve(backend.page(args));
      }
      if (cmd === "load_provider_messages") {
        return Promise.resolve(backend.all);
      }
      if (cmd === "get_provider_message_offset") {
        const idx = backend.all.findIndex((m) => m.uuid === args.messageUuid);
        return Promise.resolve(
          idx === -1 ? null : backend.all.length - 1 - idx,
        );
      }
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    },
  );
};

/** Hold the next page response while a newer request takes ownership. */
const deferNextPage = () => {
  type Page = ReturnType<ReturnType<typeof makeBackend>["page"]>;
  let release!: (page: Page) => void;
  const pending = new Promise<Page>((resolve) => { release = resolve; });
  mockApi.mockImplementationOnce((cmd: string) => {
    expect(cmd).toBe("load_provider_messages_paginated");
    return pending;
  });
  return release;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("messageSlice — chat-style pagination", () => {
  it("distinguishes watcher tail refresh, older-page prepend, and filter replacement", async () => {
    const store = createTestStore();
    installBackend(makeBackend(500));
    const kind = () => store.getState().messageUpdateKind;
    await store.getState().selectSession(makeSession());
    expect(kind()).toBe("replace");
    installBackend(makeBackend(501));
    await store.getState().reloadCurrent("watcher");
    expect(kind()).toBe("tail-refresh");
    await store.getState().loadMoreMessages();
    expect(kind()).toBe("prepend");
    installBackend(makeBackend(502));
    await store.getState().reloadCurrent("filter");
    expect(kind()).toBe("replace");
    await store.getState().reloadCurrent("refresh");
    expect(kind()).toBe("tail-refresh");
    await store.getState().selectSession(makeSession({ session_id: "other", file_path: "/tmp/other.jsonl" }));
    expect(kind()).toBe("replace");
  });

  it("rejects a stale watcher response after a newer filter replacement", async () => {
    const store = createTestStore();
    installBackend(makeBackend(500));
    await store.getState().selectSession(makeSession());

    const release = deferNextPage();
    const stale = store.getState().reloadCurrent("watcher");
    installBackend(makeBackend(501));
    await store.getState().reloadCurrent("filter");
    const current = store.getState();
    expect(current.messageUpdateKind).toBe("replace");
    expect(current.messages.at(-1)?.uuid).toBe("uuid-501");

    release(makeBackend(502).page({ offset: 0, limit: MESSAGE_PAGE_SIZE }));
    await stale;
    expect(store.getState().messages).toBe(current.messages);
    expect(store.getState().pagination).toEqual(current.pagination);
    expect(store.getState().messageUpdateKind).toBe("replace");
  });

  it("rejects a stale older-page response after a newer tail refresh", async () => {
    const store = createTestStore();
    installBackend(makeBackend(500));
    await store.getState().selectSession(makeSession());

    const release = deferNextPage();
    const older = store.getState().loadMoreMessages();
    // loadMoreMessages queues its fetch on the older-page promise chain.
    await Promise.resolve();
    expect(store.getState().pagination.isLoadingMore).toBe(true);
    installBackend(makeBackend(501));
    await store.getState().reloadCurrent("watcher");
    const current = store.getState();
    expect(current.messageUpdateKind).toBe("tail-refresh");
    expect(current.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(current.messages.at(-1)?.uuid).toBe("uuid-501");

    release(makeBackend(500).page({ offset: MESSAGE_PAGE_SIZE, limit: MESSAGE_PAGE_SIZE }));
    await older;
    expect(store.getState().messages).toBe(current.messages);
    expect(store.getState().pagination).toEqual(current.pagination);
    expect(store.getState().messageUpdateKind).toBe("tail-refresh");
  });

  it("rejects a stale response from a different source with the same session ID", async () => {
    const store = createTestStore();
    installBackend(makeBackend(500));
    const original = makeSession();
    await store.getState().selectSession(original);

    const release = deferNextPage();
    const stale = store.getState().reloadCurrent("watcher");
    const other = makeSession({ file_path: "/review-other-source/session.jsonl", provider: "codex" });
    expect(other.session_id).toBe(original.session_id);
    installBackend(makeBackend(10));
    await store.getState().selectSession(other);
    const current = store.getState();
    expect(current.messageUpdateKind).toBe("replace");
    expect(current.messages).toHaveLength(10);
    expect(current.selectedSession).toEqual(other);

    release(makeBackend(501).page({ offset: 0, limit: MESSAGE_PAGE_SIZE }));
    await stale;
    expect(store.getState().messages).toBe(current.messages);
    expect(store.getState().pagination).toEqual(current.pagination);
    expect(store.getState().selectedSession).toEqual(other);
    expect(store.getState().messageUpdateKind).toBe("replace");
  });

  beforeEach(() => {
    mockApi.mockReset();
    mockToastError.mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, "", "/");
  });

  it("writes the selected session to the WebUI URL", async () => {
    const store = createTestStore();
    installBackend(makeBackend(1));

    await store.getState().selectSession(makeSession());

    const url = new URL(window.location.href);
    expect(url.searchParams.get("session")).toBe("session-1");
    expect(url.searchParams.get("msg")).toBeNull();
  });

  it("preserves a message target when loading the session from that deep link", async () => {
    window.history.replaceState(
      {},
      "",
      "/?session=session-1&msg=uuid-1",
    );
    const store = createTestStore();
    installBackend(makeBackend(1));

    await store.getState().selectSession(makeSession());

    const url = new URL(window.location.href);
    expect(url.searchParams.get("session")).toBe("session-1");
    expect(url.searchParams.get("msg")).toBe("uuid-1");
  });

  it("retains a loaded Codex start for outline/model/export while hiding its progress row", async () => {
    const turn = { started: { type: "task_started", turn_id: "g" }, context: { turn_id: "g" } };
    const withTurn = (message: ClaudeMessage): ClaudeMessage => ({ ...message, provider: "codex", codexEvidence: { turn } });
    const source = [withTurn({ ...user("start"), type: "progress", role: "system", data: { type: "waiting_for_task", status: "started", taskId: "g" } }), withTurn(user("context", "<environment_context>cwd</environment_context>")), withTurn(tool("work"))];
    const backend = makeBackend(3);backend.all.splice(0, 3, ...source);installBackend(backend);
    const store = createTestStore();
    await store.getState().selectSession(makeSession({provider: "codex"}));
    const visible = store.getState().messages;
    expect(visible.map(m => m.uuid)).toEqual(["context", "work"]);
    expect(groupTurns(getFilteredClassifiedMessages(visible)).map(t => t.kind)).toEqual(["automated"]);
    expect(buildTranscriptItems(flattened(visible), new Map()).turns.map(t => t.kind)).toEqual(["automated"]);
    expect(groupTurns(getFilteredClassifiedMessages(await store.getState().fetchFullSessionMessages())).map(t => t.kind)).toEqual(["automated"]);
    expect(groupTurns(getFilteredClassifiedMessages(visible.slice(1))).map(t => t.kind)).toEqual(["unknown"]);
    // A new partial load cannot reuse the earlier window's hidden start.
    backend.all.splice(0, 1);
    await store.getState().selectSession(makeSession({provider: "codex"}));
    expect(groupTurns(getFilteredClassifiedMessages(store.getState().messages)).map(t => t.kind)).toEqual(["unknown"]);
  });
  it.each([false, true])("retains a Codex start across an older-page boundary (showSystemMessages=%s)", async (showSystemMessages) => {
    const withTurn = (message: ClaudeMessage, id: string, input = false): ClaudeMessage => ({
      ...message,
      provider: "codex",
      codexEvidence: { turn: {
        started: { type: "task_started", turn_id: id },
        context: { turn_id: id },
        ...(input ? { input: { type: "user_message", message: "Typed prompt" } } : {}),
      } },
    });
    const start = withTurn({ ...user("boundary-start"), type: "progress", role: "system", data: { type: "waiting_for_task", status: "started", taskId: "g" } }, "g");
    const context = withTurn(user("boundary-context", "<environment_context>cwd</environment_context>"), "g");
    const source = [
      withTurn(user("human", "Typed prompt"), "h", true),
      withTurn(tool("human-work"), "h", true),
      start,
      context,
      ...Array.from({ length: MESSAGE_PAGE_SIZE - 1 }, (_, i) => withTurn(tool(`auto-${i}`), "g")),
    ];
    const backend = makeBackend(source.length);
    backend.all.splice(0, source.length, ...source);
    installBackend(backend);
    const store = createTestStore();
    store.setState({ showSystemMessages });
    await store.getState().selectSession(makeSession({ provider: "codex" }));
    expect(groupTurns(getFilteredClassifiedMessages(store.getState().messages)).map(t => t.kind)).toEqual(["unknown"]);

    await store.getState().loadMoreMessages();

    const visible = store.getState().messages;
    expect(groupTurns(getFilteredClassifiedMessages(visible)).map(t => t.kind)).toEqual(["human", "automated"]);
    expect(buildTranscriptItems(flattened(visible), new Map()).turns.map(t => t.kind)).toEqual(["human", "automated"]);
    expect(visible.some(m => m.uuid === start.uuid)).toBe(showSystemMessages);
    if (!showSystemMessages) expect(visible.find(m => m.uuid === context.uuid)?.codexLoadedStart).toEqual(start);
    expect(visible.map(m => m.uuid)).toEqual(source.filter(m => showSystemMessages || m.type !== "progress").map(m => m.uuid));
    expect(store.getState().pagination).toMatchObject({ currentOffset: source.length, totalCount: source.length, hasMore: false, isLoadingMore: false });
  });

  it("selectSession loads only the newest window", async () => {
    const store = createTestStore();
    const backend = makeBackend(500);
    installBackend(backend);

    await store.getState().selectSession(makeSession());

    const state = store.getState();
    expect(state.messages).toHaveLength(MESSAGE_PAGE_SIZE);
    expect(state.messages[0]?.uuid).toBe(`uuid-${500 - MESSAGE_PAGE_SIZE + 1}`);
    expect(state.messages.at(-1)?.uuid).toBe("uuid-500");
    expect(state.pagination).toMatchObject({
      currentOffset: MESSAGE_PAGE_SIZE,
      totalCount: 500,
      hasMore: true,
      isLoadingMore: false,
    });
  });

  it("loadMoreMessages prepends the older page and keeps order", async () => {
    const store = createTestStore();
    const backend = makeBackend(500);
    installBackend(backend);
    await store.getState().selectSession(makeSession());

    await store.getState().loadMoreMessages();

    const state = store.getState();
    expect(state.messages).toHaveLength(MESSAGE_PAGE_SIZE * 2);
    expect(state.messages[0]?.uuid).toBe(
      `uuid-${500 - MESSAGE_PAGE_SIZE * 2 + 1}`,
    );
    expect(state.messages.at(-1)?.uuid).toBe("uuid-500");
    expect(state.pagination.currentOffset).toBe(MESSAGE_PAGE_SIZE * 2);
    expect(state.pagination.hasMore).toBe(true);

    // Final partial page exhausts the session
    await store.getState().loadMoreMessages();
    expect(store.getState().messages).toHaveLength(500);
    expect(store.getState().pagination.hasMore).toBe(false);
  });

  it("loadMoreMessages dedups overlap when the live file grew mid-scroll", async () => {
    const store = createTestStore();
    const backend = makeBackend(300);
    installBackend(backend);
    await store.getState().selectSession(makeSession());
    expect(store.getState().messages).toHaveLength(MESSAGE_PAGE_SIZE);

    // Session file grows by 10 messages: offsets from the newest end shift,
    // so the next page overlaps the already-loaded window head.
    const grown = makeBackend(310);
    installBackend(grown);

    await store.getState().loadMoreMessages();

    const uuids = store.getState().messages.map((m) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length); // no duplicates
  });

  it("in-place reload preserves the paged-in window span", async () => {
    const store = createTestStore();
    const backend = makeBackend(500);
    installBackend(backend);
    const session = makeSession();
    await store.getState().selectSession(session);
    await store.getState().loadMoreMessages();
    expect(store.getState().messages).toHaveLength(MESSAGE_PAGE_SIZE * 2);

    // Re-select the same session (filter toggle / watcher refresh path)
    await store.getState().selectSession(session);

    expect(store.getState().messages).toHaveLength(MESSAGE_PAGE_SIZE * 2);
    expect(store.getState().pagination.currentOffset).toBe(
      MESSAGE_PAGE_SIZE * 2,
    );
  });

  it("ensureMessageLoaded extends the window to cover a deep-linked uuid", async () => {
    const store = createTestStore();
    const backend = makeBackend(900);
    installBackend(backend);
    await store.getState().selectSession(makeSession());
    expect(
      store.getState().messages.some((m) => m.uuid === "uuid-100"),
    ).toBe(false);

    const found = await store.getState().ensureMessageLoaded("uuid-100");

    expect(found).toBe(true);
    expect(
      store.getState().messages.some((m) => m.uuid === "uuid-100"),
    ).toBe(true);
    // Window is contiguous back to the target
    expect(store.getState().pagination.currentOffset).toBeGreaterThanOrEqual(
      900 - 100 + 1,
    );
  });

  it("ensureMessageLoaded returns false for an unknown uuid without looping", async () => {
    const store = createTestStore();
    const backend = makeBackend(500);
    installBackend(backend);
    await store.getState().selectSession(makeSession());
    const before = store.getState().pagination.currentOffset;

    const found = await store.getState().ensureMessageLoaded("no-such-uuid");

    expect(found).toBe(false);
    expect(store.getState().pagination.currentOffset).toBe(before);
  });

  it("fetchFullSessionMessages returns the whole session and caches", async () => {
    const store = createTestStore();
    const backend = makeBackend(500);
    installBackend(backend);
    await store.getState().selectSession(makeSession());

    const full = await store.getState().fetchFullSessionMessages();
    expect(full).toHaveLength(500);

    const again = await store.getState().fetchFullSessionMessages();
    expect(again).toBe(full); // cached promise result

    const fullLoadCalls = mockApi.mock.calls.filter(
      ([cmd]) => cmd === "load_provider_messages",
    );
    expect(fullLoadCalls).toHaveLength(1);
  });

  it("drops a stale overlapping in-place reload (epoch guard)", async () => {
    const store = createTestStore();
    const session = makeSession();

    // Two overlapping reloads of the SAME file: the first request resolves
    // LAST and must not overwrite the newer reload's window.
    let call = 0;
    const resolvers: Array<(v: unknown) => void> = [];
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "load_provider_messages_paginated") {
        call += 1;
        const mine = call;
        return new Promise((resolve) => {
          resolvers[mine - 1] = resolve;
        });
      }
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const first = store.getState().selectSession(session);
    const second = store.getState().selectSession(session);

    const pageOf = (uuid: string) => ({
      messages: [makeMessage(uuid)],
      total_count: 1,
      has_more: false,
      next_offset: 1,
    });

    // Newer request resolves first...
    resolvers[1]?.(pageOf("from-second"));
    await second;
    // ...then the stale one lands late.
    resolvers[0]?.(pageOf("from-first"));
    await first;

    expect(store.getState().messages.map((m) => m.uuid)).toEqual([
      "from-second",
    ]);
  });

  it("fetchFullSessionMessages reuses the window when everything is loaded", async () => {
    const store = createTestStore();
    const backend = makeBackend(50);
    installBackend(backend);
    await store.getState().selectSession(makeSession());
    expect(store.getState().pagination.hasMore).toBe(false);

    const full = await store.getState().fetchFullSessionMessages();

    expect(full).toBe(store.getState().messages);
    expect(
      mockApi.mock.calls.filter(([cmd]) => cmd === "load_provider_messages"),
    ).toHaveLength(0);
  });
});
