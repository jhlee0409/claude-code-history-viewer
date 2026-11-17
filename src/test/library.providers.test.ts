/**
 * Library entries (Recent, Favourites) reopen sessions of every provider
 * (T7 review R1). Most providers list projects under a virtual path
 * (`codex://{cwd}`, `copilot-cli://{cwd}`, `opencode://{id}`) while their
 * session files live elsewhere (`~/.codex/sessions/.../rollout-*.jsonl`,
 * `~/.copilot/session-state/<id>/events.jsonl`), so a session file is not
 * "under" its project's path. A ref therefore records its project's path,
 * and opening it loads that project's list the way the sidebar does.
 * A ref saved before that (legacy) still opens: the open project's list,
 * then path containment, then the provider's other projects.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeProject, ClaudeSession, MessagePage, UserMetadata } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useAppStore } from "@/store/useAppStore";
import { favoritesOf, loadRecent } from "@/navigation/library";
import { openSessionRef } from "@/navigation/openSessionRef";
import type { SessionRef } from "@/navigation/place";

const project = (path: string, provider: string): ClaudeProject => ({
  name: path.split("/").pop() ?? path,
  path,
  actual_path: path.replace(/^[a-z-]+:\/\//, ""),
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider,
});
const session = (p: ClaudeProject, id: string, filePath: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: filePath,
  project_name: p.name,
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  provider: p.provider as ClaudeSession["provider"],
  summary: `summary ${id}`,
});

const CLAUDE = project("/home/u/.claude/projects/-work-alpha", "claude");
const CLAUDE_1 = session(CLAUDE, "c1", `${CLAUDE.path}/c1.jsonl`);
const CODEX_A = project("codex:///work/alpha", "codex");
const CODEX_B = project("codex:///work/beta", "codex");
const CODEX_A1 = session(CODEX_A, "x1", "/home/u/.codex/sessions/2026/10/15/rollout-2026-10-15T10-00-00-x1.jsonl");
const CODEX_B1 = session(CODEX_B, "y1", "/home/u/.codex/sessions/2026/10/14/rollout-2026-10-14T09-00-00-y1.jsonl");
const COPILOT = project("copilot-cli:///work/gamma", "copilot");
const COPILOT_1 = session(COPILOT, "g1", "/home/u/.copilot/session-state/g1/events.jsonl");
const OPENCODE = project("opencode://proj_1", "opencode");
const OPENCODE_1 = session(OPENCODE, "opencode://ses_1", "opencode://proj_1/ses_1");

const PROJECTS = [CLAUDE, CODEX_A, CODEX_B, COPILOT, OPENCODE];
const LIST: Record<string, ClaudeSession[]> = {
  [CLAUDE.path]: [CLAUDE_1],
  [CODEX_A.path]: [CODEX_A1],
  [CODEX_B.path]: [CODEX_B1],
  [COPILOT.path]: [COPILOT_1],
  [OPENCODE.path]: [OPENCODE_1],
};
const PAGE: MessagePage = { messages: [], total_count: 0, has_more: false, next_offset: 0 };

let disk: UserMetadata;
const pristine = useAppStore.getState();

beforeEach(() => {
  localStorage.clear();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
  disk = { version: 1, sessions: {}, projects: {}, settings: {} };
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case "load_provider_sessions_page": {
        const sessions = LIST[String(args.projectPath)] ?? [];
        return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
      }
      case "load_project_sessions":
      case "load_provider_sessions":
        return LIST[String(args.projectPath)] ?? [];
      case "load_provider_messages_paginated":
        return PAGE;
      case "update_session_metadata": {
        const update = JSON.parse(JSON.stringify(args.update)) as Record<string, unknown>;
        const sessions = { ...disk.sessions };
        if (Object.keys(update).length === 0) delete sessions[String(args.sessionId)];
        else sessions[String(args.sessionId)] = update;
        disk = { ...disk, sessions };
        return disk;
      }
      default:
        return null;
    }
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/u/.claude", projects: PROJECTS, recentSessions: [] });
});

const state = () => useAppStore.getState();
/** Project paths whose session list was read to find a session. */
const listLoads = () =>
  apiMock.mock.calls
    .filter(([c]) => c === "load_project_sessions" || c === "load_provider_sessions")
    .map(([, a]) => (a as { projectPath: string }).projectPath);

/** Restart: a fresh store holding what is on disk (metadata, recent list). */
function restart() {
  useAppStore.setState(pristine, true);
  useAppStore.setState({
    claudePath: "/home/u/.claude",
    projects: PROJECTS,
    userMetadata: disk,
    recentSessions: loadRecent(),
  });
  apiMock.mockClear();
}

describe.each([
  ["claude", CLAUDE, CLAUDE_1],
  ["codex", CODEX_A, CODEX_A1],
  ["copilot", COPILOT, COPILOT_1],
  ["opencode", OPENCODE, OPENCODE_1],
] as const)("a %s session", (_provider, home, target) => {
  it("reopens from Favourites: from another project and after a restart", async () => {
    await state().navigate({ view: "conversation", project: home, session: target });
    await state().toggleSessionFavorite(target);
    expect(disk.sessions[target.session_id]?.ref).toMatchObject({
      provider: home.provider,
      filePath: target.file_path,
      projectPath: home.path,
    });
    const elsewhere = home === CLAUDE ? CODEX_B : CLAUDE;
    await state().navigate({ view: "conversation", project: elsewhere, session: LIST[elsewhere.path]![0]! });
    apiMock.mockClear();

    const [favourite] = favoritesOf(state().userMetadata);
    expect(await openSessionRef(favourite!.ref!)).toBe("opened");
    expect(state().selectedProject?.path).toBe(home.path);
    expect(state().selectedSession?.file_path).toBe(target.file_path);
    // Its own project's list only, the way the sidebar loads it.
    expect(listLoads()).toEqual([home.path]);

    restart();
    const [again] = favoritesOf(state().userMetadata);
    expect(await openSessionRef(again!.ref!)).toBe("opened");
    expect(state().selectedSession?.file_path).toBe(target.file_path);
    expect(listLoads()).toEqual([home.path]);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("reopens from Recent: from another project, while its project is open, after a restart", async () => {
    await state().navigate({ view: "conversation", project: home, session: target });
    expect(state().recentSessions[0]?.ref).toMatchObject({ filePath: target.file_path, projectPath: home.path });
    const elsewhere = home === CLAUDE ? CODEX_B : CLAUDE;
    await state().navigate({ view: "conversation", project: elsewhere, session: LIST[elsewhere.path]![0]! });

    const entry = () => state().recentSessions.find((e) => e.ref.filePath === target.file_path)!;
    expect(await openSessionRef(entry().ref)).toBe("opened");
    expect(state().selectedSession?.file_path).toBe(target.file_path);

    // Its project open, no session: the loaded list is used as is.
    await state().navigate({ session: null });
    apiMock.mockClear();
    expect(await openSessionRef(entry().ref)).toBe("opened");
    expect(state().selectedSession?.file_path).toBe(target.file_path);
    expect(listLoads()).toEqual([]);

    restart();
    expect(await openSessionRef(entry().ref)).toBe("opened");
    expect(state().selectedProject?.path).toBe(home.path);
    expect(state().selectedSession?.file_path).toBe(target.file_path);
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe("a ref saved before it named its project (legacy)", () => {
  const legacy = (s: ClaudeSession): SessionRef => ({
    provider: s.provider ?? "claude",
    filePath: s.file_path,
    sessionId: s.session_id,
  });

  it("a Claude Code session is found by path containment, one list read", async () => {
    expect(await openSessionRef(legacy(CLAUDE_1))).toBe("opened");
    expect(listLoads()).toEqual([CLAUDE.path]);
  });

  it("a Codex session is found among Codex projects only", async () => {
    expect(await openSessionRef(legacy(CODEX_B1))).toBe("opened");
    expect(state().selectedProject?.path).toBe(CODEX_B.path);
    expect(state().selectedSession?.file_path).toBe(CODEX_B1.file_path);
    expect(listLoads()).toEqual([CODEX_A.path, CODEX_B.path]);
  });

  it("a session in the open project's list opens without a load", async () => {
    await state().navigate({ view: "conversation", project: COPILOT });
    apiMock.mockClear();
    expect(await openSessionRef(legacy(COPILOT_1))).toBe("opened");
    expect(listLoads()).toEqual([]);
  });

  it("a session that is gone says so once and stays put", async () => {
    const gone: SessionRef = { provider: "codex", filePath: "/home/u/.codex/sessions/gone.jsonl", sessionId: "gone" };
    expect(await openSessionRef(gone)).toBe("notFound");
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(state().selectedSession).toBeNull();
  });
});

describe("a legacy favourite learns its project", () => {
  it("the backfill records the open project's path", async () => {
    disk = { ...disk, sessions: { [CODEX_A1.session_id]: { starred: true } } };
    useAppStore.setState({ userMetadata: disk });
    await state().navigate({ view: "conversation", project: CODEX_A });

    await state().backfillFavoriteRefs(state().sessions);

    expect(disk.sessions[CODEX_A1.session_id]?.ref).toMatchObject({
      provider: "codex",
      filePath: CODEX_A1.file_path,
      projectPath: CODEX_A.path,
    });
    restart();
    const [favourite] = favoritesOf(state().userMetadata);
    expect(await openSessionRef(favourite!.ref!)).toBe("opened");
    expect(listLoads()).toEqual([CODEX_A.path]);
  });
});
