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
