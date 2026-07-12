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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("messageSlice — chat-style pagination", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockToastError.mockReset();
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
