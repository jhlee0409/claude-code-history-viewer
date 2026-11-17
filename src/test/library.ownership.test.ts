/**
 * Library entries follow the navigation ownership rule (plan T2 §4.2, T7
 * review R2): the latest intent wins. A Recent / Favourites click claims the
 * navigation when it is made, before its lookup awaits, so a click made
 * after it - or a CLI hint, a browser back, any navigation - supersedes it
 * whatever order the lookups finish in. A superseded lookup says nothing,
 * not even when it fails or finds nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useAppStore } from "@/store/useAppStore";
import { openSessionRef } from "@/navigation/openSessionRef";
import { openSessionHint } from "@/lib/preloadSession";
import { libraryRefOf } from "@/navigation/library";

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
const C = project("c");
const A1 = sessionOf(A, "a1");
const B1 = sessionOf(B, "b1");
const C1 = sessionOf(C, "c1");
const LIST: Record<string, ClaudeSession[]> = { [A.path]: [A1], [B.path]: [B1], [C.path]: [C1] };
const PAGE: MessagePage = { messages: [], total_count: 0, has_more: false, next_offset: 0 };

/** Lookups (`load_project_sessions`) held until the test settles them. */
let held: Map<string, { resolve: (v: ClaudeSession[]) => void; reject: (e: unknown) => void }>;
const pristine = useAppStore.getState();

beforeEach(() => {
  held = new Map();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
  apiMock.mockReset();
  apiMock.mockImplementation((command: string, args: Record<string, unknown> = {}) => {
    const path = String(args.projectPath);
    switch (command) {
      case "load_project_sessions":
        return new Promise((resolve, reject) => held.set(path, { resolve, reject }));
      case "load_provider_sessions_page": {
        const sessions = LIST[path] ?? [];
        return Promise.resolve({ sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false });
      }
      case "load_provider_messages_paginated":
        return Promise.resolve(PAGE);
      default:
        return Promise.resolve(null);
    }
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  localStorage.clear();
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B, C], recentSessions: [] });
});

const state = () => useAppStore.getState();
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const release = async (p: ClaudeProject, list: ClaudeSession[] | Error = LIST[p.path]!) => {
  const lookup = held.get(p.path)!;
  if (list instanceof Error) lookup.reject(list);
  else lookup.resolve(list);
  await settle();
};
const ref = (p: ClaudeProject, s: ClaudeSession) => libraryRefOf(s, p);

describe("two library clicks: the later one wins", () => {
  it("the earlier lookup finishing first does not open it", async () => {
    const first = openSessionRef(ref(A, A1));
    const second = openSessionRef(ref(B, B1));
    await release(A);
    await release(B);
    expect(await first).toBe("superseded");
    expect(await second).toBe("opened");
    expect(state().selectedSession?.file_path).toBe(B1.file_path);
  });

  it("the later lookup finishing first stays open", async () => {
    const first = openSessionRef(ref(A, A1));
    const second = openSessionRef(ref(B, B1));
    await release(B);
    await release(A);
    expect(await second).toBe("opened");
    expect(await first).toBe("superseded");
    expect(state().selectedSession?.file_path).toBe(B1.file_path);
    expect(state().recentSessions.map((e) => e.ref.filePath)).toEqual([B1.file_path]);
  });

  it("a superseded lookup that fails or finds nothing says nothing", async () => {
    const failing = openSessionRef(ref(A, A1));
    const empty = openSessionRef(ref(C, C1));
    const last = openSessionRef(ref(B, B1));
    await release(A, new Error("disk"));
    await release(C, []);
    await release(B);
    expect(await failing).toBe("superseded");
    expect(await empty).toBe("superseded");
    expect(await last).toBe("opened");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe("any later navigation wins over a library click", () => {
  it("a CLI hint that arrives meanwhile", async () => {
    const click = openSessionRef(ref(A, A1));
    const hint = openSessionHint({ kind: "path", value: C1.file_path }, { t: (k) => k });
    await release(A);
    // The hint scans projects in order: A (again), B, then C.
    for (const p of [A, B, C]) if (held.has(p.path)) await release(p);
    await settle();
    expect(await click).toBe("superseded");
    await hint;
    expect(state().selectedSession?.file_path).not.toBe(A1.file_path);
  });

  it("a browser back / any navigate meanwhile", async () => {
    await state().navigate({ view: "analytics", project: C });
    const click = openSessionRef(ref(A, A1));
    await state().navigate({ view: "globalStats" });
    await release(A);
    expect(await click).toBe("superseded");
    expect(state().view).toBe("globalStats");
    expect(state().selectedSession).toBeNull();
  });
});
