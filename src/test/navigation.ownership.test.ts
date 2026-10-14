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
