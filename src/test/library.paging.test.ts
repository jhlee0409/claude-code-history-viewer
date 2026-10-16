/**
 * A library entry (Recent, Favourites) in the open project opens even when
 * the sidebar holds only part of that project's list (T7 re-review F1).
 *
 * The open project's list is paginated (`SESSION_PAGE_LIMIT` = 250) and is
 * empty while its first page loads, so a miss in it says nothing about the
 * session: the opener looks it up directly - Claude Code by its file
 * (`load_provider_session_by_path`), every other provider through its full
 * list - and opens it without it being in the loaded page. Only a complete
 * list (no more pages, nothing loading) is proof that the session is gone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession, MessagePage } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useAppStore } from "@/store/useAppStore";
import { libraryRefOf } from "@/navigation/library";
import { openSessionRef } from "@/navigation/openSessionRef";

const PAGE_SIZE = 250;
const TOTAL = 301;

const projectOf = (provider: "claude" | "codex"): ClaudeProject => ({
  name: "repo",
  path: provider === "claude" ? "/home/u/.claude/projects/-work-repo" : "codex:///work/repo",
  actual_path: "/work/repo",
  session_count: TOTAL,
  message_count: TOTAL,
  last_modified: "",
  provider,
});
const sessionOf = (p: ClaudeProject, id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path:
    p.provider === "claude"
      ? `${p.path}/${id}.jsonl`
      : `/home/u/.codex/sessions/2026/10/17/rollout-2026-10-17T00-00-00-${id}.jsonl`,
  project_name: p.name,
  provider: p.provider as ClaudeSession["provider"],
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "2026-10-17T00:00:00Z",
  has_errors: false,
  has_tool_use: false,
  summary: `summary ${id}`,
});
const EMPTY_PAGE: MessagePage = { messages: [], total_count: 0, has_more: false, next_offset: 0 };

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
/** Every backend read the opener made to find a session. */
const lookups = () =>
  apiMock.mock.calls
    .map(([command]) => command as string)
    .filter((c) => c === "load_project_sessions" || c === "load_provider_sessions" || c === "load_provider_session_by_path");

/** The project's sessions on disk; `older` sits beyond the first page. */
function diskOf(p: ClaudeProject) {
  const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => sessionOf(p, `newest-${i}`));
  const rest = Array.from({ length: TOTAL - PAGE_SIZE - 1 }, (_, i) => sessionOf(p, `rest-${i}`));
  const older = sessionOf(p, "older");
  return { firstPage, all: [...firstPage, ...rest, older], older };
}

function serve(all: ClaudeSession[]) {
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case "load_project_sessions":
      case "load_provider_sessions":
        return all;
      case "load_provider_session_by_path":
        if (args.provider !== "claude") throw new Error(`unsupported provider ${String(args.provider)}`);
        return all.find((s) => s.file_path === args.filePath) ?? null;
      case "load_provider_sessions_page":
        return { sessions: all.slice(0, PAGE_SIZE), total: all.length, nextOffset: PAGE_SIZE, hasMore: all.length > PAGE_SIZE };
      case "load_provider_messages_paginated":
        return EMPTY_PAGE;
      default:
        return null;
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
  apiMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/u/.claude" });
});

describe.each(["claude", "codex"] as const)("%s: the open project holds part of its list", (provider) => {
  const p = projectOf(provider);
  const { firstPage, all, older } = diskOf(p);

  it(`a session beyond the first ${PAGE_SIZE} of ${TOTAL} opens`, async () => {
    serve(all);
    useAppStore.setState({
      projects: [p],
      selectedProject: p,
      sessions: firstPage,
      sessionsTotal: TOTAL,
      sessionsOffset: PAGE_SIZE,
      hasMoreSessions: true,
    });

    expect(await openSessionRef(libraryRefOf(older, p))).toBe("opened");

    expect(state().selectedProject?.path).toBe(p.path);
    expect(state().selectedSession?.file_path).toBe(older.file_path);
    expect(lookups().length).toBeGreaterThan(0);
    // Claude Code reads the one file, not the whole project.
    if (provider === "claude") expect(lookups()).toEqual(["load_provider_session_by_path"]);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("a session clicked while the first page is still loading opens", async () => {
    serve(all);
    useAppStore.setState({
      projects: [p],
      selectedProject: p,
      sessions: [],
      sessionsTotal: 0,
      hasMoreSessions: false,
      isLoadingSessions: true,
    });

    expect(await openSessionRef(libraryRefOf(older, p))).toBe("opened");

    expect(state().selectedSession?.file_path).toBe(older.file_path);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("a deleted session beyond the loaded page says so once and stays put", async () => {
    const remaining = all.filter((s) => s.file_path !== older.file_path);
    serve(remaining);
    useAppStore.setState({
      projects: [p],
      selectedProject: p,
      sessions: firstPage,
      sessionsTotal: TOTAL - 1,
      sessionsOffset: PAGE_SIZE,
      hasMoreSessions: true,
    });

    expect(await openSessionRef(libraryRefOf(older, p))).toBe("notFound");

    expect(lookups().length).toBeGreaterThan(0);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(state().selectedSession).toBeNull();
  });

  it("a miss in a complete list is conclusive: no lookup, one toast", async () => {
    const small = firstPage.slice(0, 10);
    serve(small);
    useAppStore.setState({
      projects: [p],
      selectedProject: p,
      sessions: small,
      sessionsTotal: small.length,
      sessionsOffset: small.length,
      hasMoreSessions: false,
      isLoadingSessions: false,
    });

    expect(await openSessionRef(libraryRefOf(older, p))).toBe("notFound");

    expect(lookups()).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });
});

it("Claude Code: a failed single-file lookup falls back to the project's list", async () => {
  const p = projectOf("claude");
  const { firstPage, all, older } = diskOf(p);
  serve(all);
  const served = apiMock.getMockImplementation()!;
  apiMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "load_provider_session_by_path") throw new Error("rejected path");
    return served(command, args);
  });
  useAppStore.setState({
    projects: [p],
    selectedProject: p,
    sessions: firstPage,
    sessionsTotal: TOTAL,
    sessionsOffset: PAGE_SIZE,
    hasMoreSessions: true,
  });

  expect(await openSessionRef(libraryRefOf(older, p))).toBe("opened");

  expect(lookups()).toEqual(["load_provider_session_by_path", "load_project_sessions"]);
  expect(state().selectedSession?.file_path).toBe(older.file_path);
});

it("a newer navigation during the lookup owns the screen", async () => {
  const p = projectOf("codex");
  const { firstPage, all, older } = diskOf(p);
  let release!: (sessions: ClaudeSession[]) => void;
  serve(all);
  const served = apiMock.getMockImplementation()!;
  apiMock.mockImplementation((command: string, args?: Record<string, unknown>) =>
    command === "load_provider_sessions"
      ? new Promise<ClaudeSession[]>((resolve) => {
          release = resolve;
        })
      : served(command, args),
  );
  useAppStore.setState({
    projects: [p],
    selectedProject: p,
    sessions: firstPage,
    sessionsTotal: TOTAL,
    sessionsOffset: PAGE_SIZE,
    hasMoreSessions: true,
  });

  const opening = openSessionRef(libraryRefOf(older, p));
  await Promise.resolve();
  state().beginNavigation();
  release(all);

  expect(await opening).toBe("superseded");
  expect(state().selectedSession).toBeNull();
  expect(toastMock.error).not.toHaveBeenCalled();
});

it("a ref naming another project does not read the open project's full list", async () => {
  // Open: a large Codex project B (partial list). Ref: a session of project A.
  const b = { ...projectOf("codex"), name: "big", path: "codex:///work/big", actual_path: "/work/big" };
  const a = { ...projectOf("codex"), name: "small", path: "codex:///work/small", actual_path: "/work/small", session_count: 1 };
  const bPage = Array.from({ length: PAGE_SIZE }, (_, i) => sessionOf(b, `b-${i}`));
  const target = { ...sessionOf(a, "a-target"), file_path: "/home/u/.codex/sessions/2026/10/17/rollout-a-target.jsonl" };
  const loaded: string[] = [];
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "load_provider_sessions" || command === "load_project_sessions") {
      const path = String(args.projectPath ?? args.path ?? "");
      loaded.push(path);
      return path === a.path ? [target] : bPage;
    }
    if (command === "load_provider_messages_paginated") return EMPTY_PAGE;
    if (command === "load_provider_sessions_page") return { sessions: [target], total: 1, nextOffset: 1, hasMore: false };
    return null;
  });
  useAppStore.setState({
    projects: [b, a],
    selectedProject: b,
    sessions: bPage,
    sessionsTotal: 900,
    sessionsOffset: PAGE_SIZE,
    hasMoreSessions: true,
  });

  expect(await openSessionRef(libraryRefOf(target, a))).toBe("opened");

  expect(state().selectedSession?.file_path).toBe(target.file_path);
  expect(loaded).not.toContain(b.path);
});
