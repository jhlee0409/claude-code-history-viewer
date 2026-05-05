/**
 * Regression tests for SubAgent navigation + filtering + mapping.
 *
 * Covers the fixes in PR #264:
 * - selectSession async race guard (stale response abort)
 * - In-place reload preserves parentSessionStack when inside a subagent
 * - Top-level re-select clears parentSessionStack
 * - loadSubagents builds toolUseToSubagentMap from pre-filter allMessages
 * - Map skips progress msgs without parentToolUseID or with unmatched agent_id
 * - Map resolves to file_path (stable identifier) instead of agent_id
 * - navigateToSubagent / navigateBackToParent guard against concurrent double-click
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { create } from "zustand";
import type {
  ClaudeMessage,
  ClaudeProgressMessage,
  ClaudeSession,
  ProjectStatsSummary,
  SubagentSession,
} from "../types";
import { AppErrorType } from "../types";
import {
  createMessageSlice,
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
const mockToastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastWarning(...args),
  },
}));

const mockBuildSearchIndex = vi.fn();
const mockClearSearchIndex = vi.fn();
vi.mock("../utils/searchIndex", () => ({
  buildSearchIndex: (...args: unknown[]) => mockBuildSearchIndex(...args),
  clearSearchIndex: (...args: unknown[]) => mockClearSearchIndex(...args),
}));

// Jsdom doesn't have requestIdleCallback — force the setTimeout fallback path.
// 다른 테스트 worker에 영향 주지 않도록 afterAll에서 복원.
const originalRequestIdleCallback = (
  globalThis as Record<string, unknown>
).requestIdleCallback;

beforeAll(() => {
  Reflect.deleteProperty(
    globalThis as Record<string, unknown>,
    "requestIdleCallback",
  );
});

afterAll(() => {
  if (originalRequestIdleCallback !== undefined) {
    Object.defineProperty(globalThis, "requestIdleCallback", {
      configurable: true,
      writable: true,
      value: originalRequestIdleCallback,
    });
  }
});

// analyticsApi isn't exercised by these tests but is referenced by the slice.
vi.mock("../services/analyticsApi", () => ({
  fetchSessionTokenStats: vi.fn(),
  fetchProjectTokenStats: vi.fn(),
  fetchProjectStatsSummary: vi
    .fn()
    .mockResolvedValue({} as ProjectStatsSummary),
  fetchSessionComparison: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test store
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

const createTestStore = () => {
  return create<TestStore>()((set, get) => ({
    selectedSession: null,
    excludeSidechain: true,
    showSystemMessages: false,
    setError: vi.fn(),
    setSelectedSession: (s) => set({ selectedSession: s }),
    resetMessageFilter: () => {},
    selectedProject: null,
    dateFilter: { start: null, end: null },
    ...createMessageSlice(
      set as Parameters<typeof createMessageSlice>[0],
      get as Parameters<typeof createMessageSlice>[1],
    ),
  }));
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
  session_id: "sess-parent",
  actual_session_id: "sess-parent",
  file_path: "/tmp/parent.jsonl",
  project_name: "proj",
  message_count: 0,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  summary: undefined,
  ...overrides,
});

const makeSubagent = (
  agent_id: string,
  file_path: string,
): SubagentSession => ({
  agent_id,
  file_path,
  message_count: 1,
  file_size: 100,
  first_message_time: null,
  last_message_time: null,
  summary: null,
});

const makeProgress = (
  parentToolUseID: string | undefined,
  agentId: string | null,
): ClaudeProgressMessage =>
  ({
    type: "progress",
    uuid: `p-${parentToolUseID ?? "x"}`,
    parentUuid: null,
    sessionId: "sess-parent",
    timestamp: "2026-01-01T00:00:00.000Z",
    isSidechain: false,
    parentToolUseID,
    // CLAUDE.md 가이드: null/undefined 동시 체크에 != null 사용.
    // agentId가 null이면 "agent_progress 형태이지만 agentId 결측" 케이스를 커버.
    data:
      agentId != null
        ? { type: "agent_progress", agentId }
        : { type: "agent_progress" },
  }) as unknown as ClaudeProgressMessage;

const makeUserMessage = (
  uuid: string,
  isSidechain = false,
): ClaudeMessage =>
  ({
    type: "user",
    uuid,
    parentUuid: null,
    sessionId: "sess-parent",
    timestamp: "2026-01-01T00:00:00.000Z",
    isSidechain,
    message: { role: "user", content: "hi" },
  }) as unknown as ClaudeMessage;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
const defer = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("messageSlice.selectSession — async race & subagent intent", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockToastError.mockReset();
    mockToastWarning.mockReset();
    mockBuildSearchIndex.mockReset();
    mockClearSearchIndex.mockReset();
  });

  it("drops stale load when user switches session mid-flight", async () => {
    const store = createTestStore();
    const sessionA = makeSession({
      session_id: "A",
      file_path: "/tmp/A.jsonl",
    });
    const sessionB = makeSession({
      session_id: "B",
      file_path: "/tmp/B.jsonl",
    });
    const deferredA = defer<ClaudeMessage[]>();
    const deferredB = defer<ClaudeMessage[]>();

    mockApi.mockImplementation((cmd: string, args: { sessionPath: string }) => {
      if (cmd === "load_provider_messages") {
        return args.sessionPath === "/tmp/A.jsonl"
          ? deferredA.promise
          : deferredB.promise;
      }
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const pA = store.getState().selectSession(sessionA);
    const pB = store.getState().selectSession(sessionB);

    // Resolve B first (current session), then A (stale)
    deferredB.resolve([makeUserMessage("b1")]);
    await pB;
    deferredA.resolve([
      makeUserMessage("a1"),
      makeUserMessage("a2"),
    ]);
    await pA;

    // State must reflect B, not A's late-arriving messages
    expect(store.getState().selectedSession?.file_path).toBe("/tmp/B.jsonl");
    expect(store.getState().messages.map((m) => m.uuid)).toEqual(["b1"]);
  });

  it("in-place reload while inside subagent preserves parentSessionStack and skips sidechain filter", async () => {
    const store = createTestStore();
    const parent = makeSession({ file_path: "/tmp/parent.jsonl" });
    const subagentSession = makeSession({
      session_id: "/tmp/sub.jsonl",
      actual_session_id: "agent-1",
      file_path: "/tmp/sub.jsonl",
    });
    store.setState({
      selectedSession: subagentSession,
      parentSessionStack: [parent],
      excludeSidechain: true,
    });

    // All messages in the subagent file are isSidechain=true (real subagent data shape)
    const subagentMessages = [
      makeUserMessage("s1", true),
      makeUserMessage("s2", true),
    ];
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "load_provider_messages")
        return Promise.resolve(subagentMessages);
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    await store.getState().selectSession(subagentSession);

    // Stack preserved, sidechain filter bypassed → all subagent msgs visible
    expect(store.getState().parentSessionStack).toHaveLength(1);
    expect(store.getState().messages).toHaveLength(2);
  });

  it("top-level reselection clears parentSessionStack", async () => {
    const store = createTestStore();
    const top = makeSession({ file_path: "/tmp/top.jsonl" });
    // Simulate leftover stack (e.g., prior subagent view not cleaned up)
    store.setState({
      selectedSession: makeSession({ file_path: "/tmp/other.jsonl" }),
      parentSessionStack: [makeSession({ file_path: "/tmp/ghost.jsonl" })],
    });
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "load_provider_messages") return Promise.resolve([]);
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    await store.getState().selectSession(top);

    expect(store.getState().parentSessionStack).toEqual([]);
  });
});

describe("messageSlice.loadSubagents — map building from pre-filter messages", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("builds parentToolUseID → file_path map from progress messages", async () => {
    const store = createTestStore();
    const subA = makeSubagent("agent-A", "/tmp/subA.jsonl");
    const subB = makeSubagent("agent-B", "/tmp/subB.jsonl");
    const session = makeSession({ file_path: "/tmp/parent.jsonl" });
    store.setState({ selectedSession: session });

    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "get_session_subagents")
        return Promise.resolve([subA, subB]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const sourceMessages: ClaudeMessage[] = [
      makeProgress("tool-1", "agent-A"),
      makeProgress("tool-2", "agent-B"),
    ];
    await store.getState().loadSubagents(session.file_path, sourceMessages);

    const map = store.getState().toolUseToSubagentMap;
    expect(map.get("tool-1")).toBe("/tmp/subA.jsonl");
    expect(map.get("tool-2")).toBe("/tmp/subB.jsonl");
  });

  it("skips progress messages missing parentToolUseID or with unknown agent_id", async () => {
    const store = createTestStore();
    const subA = makeSubagent("agent-A", "/tmp/subA.jsonl");
    const session = makeSession({ file_path: "/tmp/parent.jsonl" });
    store.setState({ selectedSession: session });

    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "get_session_subagents") return Promise.resolve([subA]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const sourceMessages: ClaudeMessage[] = [
      makeProgress(undefined, "agent-A"), // no parentToolUseID
      makeProgress("tool-x", "agent-UNKNOWN"), // unknown agent
      makeProgress("tool-ok", "agent-A"), // valid
      makeProgress("tool-no-agent", null), // no agentId
    ];
    await store.getState().loadSubagents(session.file_path, sourceMessages);

    const map = store.getState().toolUseToSubagentMap;
    expect(Array.from(map.entries())).toEqual([
      ["tool-ok", "/tmp/subA.jsonl"],
    ]);
  });

  it("does not mutate state when selectedSession changed mid-fetch", async () => {
    const store = createTestStore();
    const originalSession = makeSession({ file_path: "/tmp/A.jsonl" });
    const otherSession = makeSession({ file_path: "/tmp/B.jsonl" });
    store.setState({ selectedSession: originalSession });

    const deferred = defer<SubagentSession[]>();
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "get_session_subagents") return deferred.promise;
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const pending = store
      .getState()
      .loadSubagents(originalSession.file_path, [
        makeProgress("tool-1", "agent-A"),
      ]);
    // User switches away while fetch is in flight
    store.setState({ selectedSession: otherSession });
    deferred.resolve([makeSubagent("agent-A", "/tmp/subA.jsonl")]);
    await pending;

    // Map for the stale session must NOT be written
    expect(store.getState().toolUseToSubagentMap.size).toBe(0);
    expect(store.getState().subagentSessions).toEqual([]);
  });

  it("resets map when api throws and we're still on the same session", async () => {
    const store = createTestStore();
    const session = makeSession({ file_path: "/tmp/A.jsonl" });
    store.setState({
      selectedSession: session,
      // Seed with a non-empty map so we can assert the reset
      toolUseToSubagentMap: new Map([["stale", "/tmp/stale.jsonl"]]),
      subagentSessions: [makeSubagent("stale", "/tmp/stale.jsonl")],
    });

    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "get_session_subagents")
        return Promise.reject(new Error("fetch failed"));
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    await store.getState().loadSubagents(session.file_path, []);

    expect(store.getState().toolUseToSubagentMap.size).toBe(0);
    expect(store.getState().subagentSessions).toEqual([]);
    // CLAUDE.md 가이드: async 실패는 사용자에게 가시적 피드백
    expect(mockToastWarning).toHaveBeenCalledWith(
      expect.stringContaining("fetch failed"),
    );
  });
});

describe("messageSlice — navigate guards & error branches", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockToastError.mockReset();
    mockToastWarning.mockReset();
  });

  it("navigateBackToParent to top-level re-applies sidechain filter (isSubagentNav reset)", async () => {
    const store = createTestStore();
    const topSession = makeSession({ file_path: "/tmp/top.jsonl" });
    const subSession = makeSession({
      session_id: "/tmp/sub.jsonl",
      actual_session_id: "agent-1",
      file_path: "/tmp/sub.jsonl",
    });
    store.setState({
      selectedSession: subSession,
      parentSessionStack: [topSession], // one level deep
      excludeSidechain: true,
    });

    // Top-level messages mix regular + sidechain — filter must strip sidechain
    mockApi.mockImplementation((cmd: string, args: { sessionPath: string }) => {
      if (cmd === "load_provider_messages" && args.sessionPath === "/tmp/top.jsonl") {
        return Promise.resolve([
          makeUserMessage("regular-1", false),
          makeUserMessage("sidechain-1", true),
          makeUserMessage("regular-2", false),
        ]);
      }
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    await store.getState().navigateBackToParent();

    // Stack empty after pop → top-level → sidechain filtered out
    expect(store.getState().parentSessionStack).toEqual([]);
    expect(store.getState().messages.map((m) => m.uuid)).toEqual([
      "regular-1",
      "regular-2",
    ]);
  });

  it("navigateToSubagent ignores concurrent double-click (no duplicate stack push)", async () => {
    const store = createTestStore();
    const parent = makeSession({ file_path: "/tmp/parent.jsonl" });
    store.setState({ selectedSession: parent });

    const deferred = defer<ClaudeMessage[]>();
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "load_provider_messages") return deferred.promise;
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const subagent = makeSubagent("agent-1", "/tmp/sub.jsonl");
    const p1 = store.getState().navigateToSubagent(subagent);
    const p2 = store.getState().navigateToSubagent(subagent);
    deferred.resolve([]);
    await Promise.all([p1, p2]);

    // Stack should contain the parent exactly once, not twice.
    expect(store.getState().parentSessionStack).toHaveLength(1);
    expect(store.getState().parentSessionStack[0]?.file_path).toBe(
      "/tmp/parent.jsonl",
    );
  });

  it("selectSession suppresses stale failure when user navigated away mid-flight", async () => {
    const store = createTestStore();
    const sessionA = makeSession({
      session_id: "A",
      file_path: "/tmp/A.jsonl",
    });
    const sessionB = makeSession({
      session_id: "B",
      file_path: "/tmp/B.jsonl",
    });
    // Deferred rejection for A
    let rejectA!: (err: Error) => void;
    const rejectPromiseA = new Promise<ClaudeMessage[]>((_, reject) => {
      rejectA = reject;
    });
    mockApi.mockImplementation((cmd: string, args: { sessionPath: string }) => {
      if (cmd === "load_provider_messages") {
        return args.sessionPath === "/tmp/A.jsonl"
          ? rejectPromiseA
          : Promise.resolve([]);
      }
      if (cmd === "get_session_subagents") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    const pA = store.getState().selectSession(sessionA);
    // User navigates to B mid-flight (selectedSession now points to B)
    store.setState({ selectedSession: sessionB });

    rejectA(new Error("abandoned A"));
    await pA;

    // Stale guard in catch: neither toast nor setError fires for the abandoned load
    expect(mockToastError).not.toHaveBeenCalled();
    expect(store.getState().setError).not.toHaveBeenCalled();
  });

  it("selectSession routes subagent load failure to toast, top-level failure to setError", async () => {
    // Top-level: setError is called
    const store = createTestStore();
    const topSession = makeSession({ file_path: "/tmp/top.jsonl" });
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "load_provider_messages")
        return Promise.reject(new Error("boom"));
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    await store.getState().selectSession(topSession);

    expect(store.getState().setError).toHaveBeenCalledWith(
      expect.objectContaining({ type: AppErrorType.UNKNOWN }),
    );
    expect(mockToastError).not.toHaveBeenCalled();

    // Subagent reload: toast is called, setError is NOT
    store.getState().setError.mockReset();
    mockToastError.mockReset();
    const subSession = makeSession({
      file_path: "/tmp/sub.jsonl",
      session_id: "/tmp/sub.jsonl",
    });
    store.setState({
      parentSessionStack: [topSession],
      selectedSession: subSession,
    });
    mockApi.mockImplementation((cmd: string) => {
      if (cmd === "load_provider_messages")
        return Promise.reject(new Error("boom"));
      return Promise.reject(new Error(`unexpected: ${cmd}`));
    });

    await store.getState().selectSession(subSession);

    expect(mockToastError).toHaveBeenCalled();
    expect(store.getState().setError).not.toHaveBeenCalled();
  });
});
