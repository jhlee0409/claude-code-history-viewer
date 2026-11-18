/**
 * Conversation branches in the message slice (#782): a forked session opens
 * on the path Claude Code resumes, the other alternative is one choice away,
 * and the transcript, search and export all read the path being shown -
 * while the paged window itself (`messages`) stays the pagination's.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { ClaudeMessage, ClaudeSession, ConversationBranches, MessagePage } from "../types";
import {
  createMessageSlice,
  MESSAGE_PAGE_SIZE,
  selectDisplayedMessages,
  type MessageSlice,
} from "../store/slices/messageSlice";

const mockApi = vi.fn();
vi.mock("@/services/api", () => ({ api: (...args: unknown[]) => mockApi(...args) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const mockClearSearchIndex = vi.fn();
vi.mock("../utils/searchIndex", () => ({
  buildSearchIndex: vi.fn(),
  clearSearchIndex: (...args: unknown[]) => mockClearSearchIndex(...args),
}));
vi.mock("../services/analyticsApi", () => ({
  fetchSessionTokenStats: vi.fn(),
  fetchProjectTokenStats: vi.fn(),
  fetchProjectStatsSummary: vi.fn(),
  fetchSessionComparison: vi.fn(),
}));

type TestStore = MessageSlice & {
  selectedSession: ClaudeSession | null;
  selectedProject: null;
  navigationEpoch: number;
  excludeSidechain: boolean;
  showSystemMessages: boolean;
  targetMessageUuid: string | null;
  sessionSearch: { query: string };
  setSessionSearchQuery: Mock;
  setSelectedSession: (session: ClaudeSession | null) => void;
  markSessionUnavailable: Mock;
};
type Store = UseBoundStore<StoreApi<TestStore>>;

const createStore = (): Store =>
  create<TestStore>()((set, get) => ({
    selectedSession: null,
    selectedProject: null,
    navigationEpoch: 0,
    excludeSidechain: true,
    showSystemMessages: false,
    targetMessageUuid: null,
    sessionSearch: { query: "" },
    setSessionSearchQuery: vi.fn(),
    setSelectedSession: (session) => set({ selectedSession: session }),
    markSessionUnavailable: vi.fn(),
    ...createMessageSlice(
      set as Parameters<typeof createMessageSlice>[0],
      get as Parameters<typeof createMessageSlice>[1],
    ),
  }));

const session = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/home/u/.claude/projects/p/s1.jsonl",
  project_name: "p",
  message_count: 6,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: "claude",
  ...overrides,
});

const message = (uuid: string): ClaudeMessage =>
  ({
    uuid,
    type: "user",
    sessionId: "s1",
    timestamp: "2026-01-01T00:00:00Z",
    isSidechain: false,
  }) as unknown as ClaudeMessage;

const range = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/**
 * A session forking at `fork`: the `old` alternative (written first, `oldLength`
 * entries) and the `new` one Claude Code resumes (`newLength` entries).
 */
function forkedSession(oldLength = 2, newLength = 2) {
  const old = range("old-", oldLength);
  const fresh = range("new-", newLength);
  const file = ["u1", "fork", ...old, ...fresh].map(message);
  const branches: ConversationBranches = {
    points: [{ parentUuid: "fork", optionIds: [0, 1], defaultOption: 1, parentOption: null }],
    options: [
      { point: 0, headUuid: "old-0", anchorUuid: "old-0" },
      { point: 0, headUuid: "new-0", anchorUuid: "new-0" },
    ],
    membership: Object.fromEntries([...old.map((u) => [u, 0]), ...fresh.map((u) => [u, 1])]),
  };
  return { file, branches, old, fresh };
}

/** A backend paging `file` from its newest end. */
function backend(file: ClaudeMessage[], branches: ConversationBranches | Error) {
  mockApi.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case "load_provider_messages_paginated": {
        const offset = args.offset as number;
        const end = file.length - offset;
        const start = Math.max(0, end - (args.limit as number));
        return {
          messages: file.slice(start, end),
          total_count: file.length,
          has_more: start > 0,
          next_offset: offset + (end - start),
        } satisfies MessagePage;
      }
      case "get_conversation_branches":
        if (branches instanceof Error) throw branches;
        return branches;
      case "get_provider_message_offset": {
        const index = file.findIndex((m) => m.uuid === args.messageUuid);
        return index === -1 ? null : file.length - 1 - index;
      }
      case "load_provider_messages":
        return file;
      case "get_session_subagents":
        return [];
      default:
        throw new Error(`unexpected command ${command}`);
    }
  });
}

const shown = (store: Store) => selectDisplayedMessages(store.getState()).map((m) => m.uuid);

describe("conversation branches in the message slice", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockClearSearchIndex.mockReset();
  });

  it("opens a forked session on the path Claude Code resumes, the window itself untouched", async () => {
    const { file, branches } = forkedSession();
    backend(file, branches);
    const store = createStore();
    await store.getState().selectSession(session());

    expect(mockApi).toHaveBeenCalledWith("get_conversation_branches", {
      provider: "claude",
      sessionPath: session().file_path,
    });
    expect(store.getState().messages.map((m) => m.uuid)).toEqual(file.map((m) => m.uuid));
    expect(shown(store)).toEqual(["u1", "fork", "new-0", "new-1"]);
  });

  it("switches the shown path, searches it again, and the full-session read follows it", async () => {
    const { file, branches } = forkedSession();
    backend(file, branches);
    const store = createStore();
    await store.getState().selectSession(session());
    store.setState({ sessionSearch: { query: "needle" } });

    await store.getState().selectConversationBranch("fork", "old-0");

    expect(shown(store)).toEqual(["u1", "fork", "old-0", "old-1"]);
    expect(mockClearSearchIndex).toHaveBeenCalled();
    expect(store.getState().setSessionSearchQuery).toHaveBeenCalledWith("needle");
    expect((await store.getState().fetchFullSessionMessages()).map((m) => m.uuid)).toEqual([
      "u1", "fork", "old-0", "old-1",
    ]);
  });

  it("pages in an older alternative that starts before the loaded window", async () => {
    // The newest page holds the resumed alternative and only the tail of
    // the old one; the fork and the old alternative's start are older.
    const { file, branches, old } = forkedSession(MESSAGE_PAGE_SIZE + 50, 10);
    backend(file, branches);
    const store = createStore();
    await store.getState().selectSession(session());
    expect(store.getState().pagination.hasMore).toBe(true);
    expect(shown(store)).toEqual(range("new-", 10));
    // Export and search read the whole session on the shown path.
    expect((await store.getState().fetchFullSessionMessages()).map((m) => m.uuid)).toEqual([
      "u1", "fork", ...range("new-", 10),
    ]);

    await store.getState().selectConversationBranch("fork", "old-0");

    // Paged back to the old alternative's first entry, which is all of it.
    expect(store.getState().messages[0]?.uuid).toBe("old-0");
    expect(shown(store)).toEqual(old);
  });

  it("ignores a choice that is not an alternative of that fork", async () => {
    const { file, branches } = forkedSession();
    backend(file, branches);
    const store = createStore();
    await store.getState().selectSession(session());
    const before = store.getState().branchSelections;
    await store.getState().selectConversationBranch("fork", "u1");
    expect(store.getState().branchSelections).toBe(before);
  });

  it("asks nothing for providers that cannot fork, and a subagent transcript has no forks", async () => {
    const { file, branches } = forkedSession();
    backend(file, branches);
    const store = createStore();
    await store.getState().selectSession(session({ provider: "codex" }));
    expect(mockApi).not.toHaveBeenCalledWith("get_conversation_branches", expect.anything());
    expect(store.getState().conversationBranches).toBeNull();

    mockApi.mockClear();
    await store.getState().selectSession(
      session({ file_path: "/home/u/.claude/projects/p/s1/subagents/agent-1.jsonl" }),
      { parentStack: [session()] },
    );
    expect(mockApi).not.toHaveBeenCalledWith("get_conversation_branches", expect.anything());
    expect(shown(store)).toEqual(file.map((m) => m.uuid));
  });

  it("still opens the session when the fork lookup fails, unfiltered", async () => {
    const { file } = forkedSession();
    backend(file, new Error("boom"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createStore();
    await store.getState().selectSession(session());
    expect(store.getState().conversationBranches).toBeNull();
    expect(shown(store)).toEqual(file.map((m) => m.uuid));
    consoleError.mockRestore();
  });

  it("switches in the alternative of a message target set before the forks were known", async () => {
    const { file, branches } = forkedSession();
    backend(file, branches);
    const store = createStore();
    store.setState({ targetMessageUuid: "old-1" });
    await store.getState().selectSession(session());
    expect(store.getState().branchSelections).toEqual({ fork: "old-0" });
    expect(shown(store)).toContain("old-1");
  });

  it("pages back when the target's alternative lies wholly before the newest page", async () => {
    // A search hit in the old alternative: the newest page holds only the
    // resumed one, so the shown path would start out empty.
    const { file, branches, old } = forkedSession(10, MESSAGE_PAGE_SIZE + 50);
    backend(file, branches);
    const store = createStore();
    store.setState({ targetMessageUuid: "old-3" });
    await store.getState().selectSession(session());
    expect(store.getState().branchSelections).toEqual({ fork: "old-0" });
    expect(shown(store)).toEqual(["u1", "fork", ...old]);
    expect(store.getState().isLoadingMessages).toBe(false);
  });

  it("keeps the forks object when a reload answers the same forks, and forgets choices for another session", async () => {
    const { file, branches } = forkedSession();
    backend(file, branches);
    const store = createStore();
    await store.getState().selectSession(session());
    const loaded = store.getState().conversationBranches;
    await store.getState().selectConversationBranch("fork", "old-0");

    // The backend answers a fresh (equal) object, as a real reload would.
    backend(file, structuredClone(branches));
    await store.getState().reloadCurrent("watcher");
    expect(store.getState().conversationBranches).toBe(loaded);
    expect(store.getState().branchSelections).toEqual({ fork: "old-0" });

    await store.getState().selectSession(session({ file_path: "/home/u/.claude/projects/p/s2.jsonl" }));
    expect(store.getState().branchSelections).toEqual({});
  });
});
