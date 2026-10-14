import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ClaudeProject, ClaudeSession } from "@/types";
import {
  fetchStartupSessionHint,
  preloadSessionFromCli,
  type PreloadDependencies,
  type SessionHint,
} from "./preloadSession";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/services/api", () => ({
  api: vi.fn(),
}));

// Mutable store state. `selectedSession` is kept to prove the resolver no
// longer reads it (an open session does not block a hint, plan §9b F4). Also
// simulates `getSessionDisplayName` used by the Stage B title-matcher.
const mockStoreState: {
  excludeSidechain: boolean;
  selectedSession: ClaudeSession | null;
  getSessionDisplayName: (id: string, fallback?: string) => string | undefined;
} = {
  excludeSidechain: false,
  selectedSession: null,
  getSessionDisplayName: (_id: string, fallback?: string) => fallback,
};
vi.mock("@/store/useAppStore", () => ({
  useAppStore: {
    getState: () => mockStoreState,
  },
}));

import { api } from "@/services/api";

const UUID = "1265cd74-caa9-472e-b343-c4f44b5cf12c";

const project: ClaudeProject = {
  name: "demo",
  path: "/home/.claude/projects/demo",
  actual_path: "/home/user/demo",
  session_count: 1,
  message_count: 5,
  last_modified: "2026-04-15T00:00:00Z",
};

const session: ClaudeSession = {
  session_id: "demo-id",
  actual_session_id: UUID,
  file_path: "/home/.claude/projects/demo/1265cd74-caa9-472e-b343-c4f44b5cf12c.jsonl",
  project_name: "demo",
  message_count: 5,
  first_message_time: "2026-04-15T00:00:00Z",
  last_message_time: "2026-04-15T00:01:00Z",
  last_modified: "2026-04-15T00:01:00Z",
  has_tool_use: false,
  has_errors: false,
};

function makeDeps(overrides: Partial<PreloadDependencies> = {}): PreloadDependencies {
  return {
    getStartupSessionHint: vi.fn().mockResolvedValue(null),
    projects: [],
    openMatch: vi.fn().mockResolvedValue(true),
    openSessionPicker: vi.fn(),
    t: (_k: string, fallback?: string) => fallback ?? "Session not found",
    ...overrides,
  };
}

describe("preloadSessionFromCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset mutable store state between tests.
    mockStoreState.excludeSidechain = false;
    mockStoreState.selectedSession = null;
    mockStoreState.getSessionDisplayName = (_id: string, fallback?: string) => fallback;
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no-ops when there is no startup hint", async () => {
    const deps = makeDeps();
    const result = await preloadSessionFromCli(deps);
    expect(result).toEqual({ handled: false, matched: false });
    expect(deps.openMatch).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("uses a WebUI session query as the startup hint", async () => {
    window.history.replaceState({}, "", `/?session=${UUID}&msg=message-123`);

    await expect(fetchStartupSessionHint()).resolves.toEqual({
      kind: "uuid",
      value: UUID,
    });
    expect(api).not.toHaveBeenCalled();
  });

  it("does not call the desktop startup-hint command in WebUI mode", async () => {
    await expect(fetchStartupSessionHint()).resolves.toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("opens a matching session across projects", async () => {
    vi.mocked(api).mockResolvedValueOnce([session] as unknown as never);
    const hint: SessionHint = { kind: "uuid", value: UUID };
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue(hint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: true });
    expect(api).toHaveBeenCalledWith("load_project_sessions", {
      projectPath: project.path,
      excludeSidechain: false,
    });
    expect(deps.openMatch).toHaveBeenCalledWith({ project, session });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("matches a UUID prefix", async () => {
    vi.mocked(api).mockResolvedValueOnce([session] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: "1265cd74",
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result.matched).toBe(true);
    expect(deps.openMatch).toHaveBeenCalledWith(expect.objectContaining({ session: session }));
  });

  it("shows a toast and reports matched=false when session is missing", async () => {
    vi.mocked(api).mockResolvedValueOnce([] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: UUID,
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(deps.openMatch).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Session not found");
  });

  it("tolerates individual project-load failures and keeps scanning", async () => {
    const projectA: ClaudeProject = { ...project, name: "a", path: "/a" };
    const projectB: ClaudeProject = { ...project, name: "b", path: "/b" };
    vi.mocked(api)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([session] as unknown as never);

    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: UUID,
      } as SessionHint),
      projects: [projectA, projectB],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result.matched).toBe(true);
    expect(deps.openMatch).toHaveBeenCalledWith(expect.objectContaining({ project: projectB }));
  });

  it("ignores unsupported hint kinds without crashing", async () => {
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "future",
        value: "irrelevant",
      } as unknown as SessionHint),
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Plan §9b F4: a second `--session` launch while a session is open used to
  // be dropped silently. The hint always wins over what is on screen; only a
  // newer navigation (isCurrent) supersedes it.
  it("opens the hint even when a session is already open", async () => {
    const openSession: ClaudeSession = { ...session, session_id: "open", actual_session_id: "open" };
    mockStoreState.selectedSession = openSession;
    vi.mocked(api).mockResolvedValueOnce([session] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: UUID,
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: true });
    expect(deps.openMatch).toHaveBeenCalledWith({ project, session });
  });

  // ===== Stage B tests =====

  it("path kind resolves by matching file_path", async () => {
    const otherSession: ClaudeSession = {
      ...session,
      session_id: "other-id",
      actual_session_id: "00000000-0000-0000-0000-000000000000",
      file_path: "/home/.claude/projects/demo/other.jsonl",
    };
    vi.mocked(api).mockResolvedValueOnce([otherSession, session] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "path",
        value: session.file_path,
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: true });
    expect(deps.openMatch).toHaveBeenCalledWith(expect.objectContaining({ session: session }));
  });

  it("folder kind selects most recent session in matching project", async () => {
    const older: ClaudeSession = {
      ...session,
      session_id: "old-id",
      actual_session_id: "aaaaaaaa-0000-0000-0000-000000000000",
      last_modified: "2026-03-01T00:00:00Z",
    };
    const newer: ClaudeSession = {
      ...session,
      session_id: "new-id",
      actual_session_id: "bbbbbbbb-0000-0000-0000-000000000000",
      last_modified: "2026-04-19T00:00:00Z",
    };
    vi.mocked(api).mockResolvedValueOnce([older, newer] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "folder",
        value: "demo", // Matches project.path's tail
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result.matched).toBe(true);
    expect(deps.openMatch).toHaveBeenCalledWith(expect.objectContaining({ session: newer }));
  });

  it("folder kind without a matching project shows not-found toast", async () => {
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "folder",
        value: "nonexistent",
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(api).not.toHaveBeenCalled(); // Didn't even load sessions
    expect(toast.error).toHaveBeenCalledWith("Session not found");
  });

  it("title kind with a single match auto-selects", async () => {
    const sessionWithSummary: ClaudeSession = {
      ...session,
      summary: "Debugging the auth bug with React",
    };
    vi.mocked(api).mockResolvedValueOnce([sessionWithSummary] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "title",
        value: "auth bug",
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: true });
    expect(deps.openMatch).toHaveBeenCalledWith(expect.objectContaining({ session: sessionWithSummary }));
    expect(deps.openSessionPicker).not.toHaveBeenCalled();
  });

  it("title kind with multiple matches opens the session picker", async () => {
    const s1: ClaudeSession = { ...session, actual_session_id: "id-1", summary: "auth bug fix" };
    const s2: ClaudeSession = { ...session, actual_session_id: "id-2", summary: "another auth bug" };
    vi.mocked(api).mockResolvedValueOnce([s1, s2] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "title",
        value: "auth bug",
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(deps.openSessionPicker).toHaveBeenCalledWith(
      [
        { project, session: s1 },
        { project, session: s2 },
      ],
      "auth bug",
    );
    expect(deps.openMatch).not.toHaveBeenCalled();
  });

  it("title kind with zero matches shows not-found toast", async () => {
    vi.mocked(api).mockResolvedValueOnce([session] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "title",
        value: "nothing matches this",
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(toast.error).toHaveBeenCalledWith("Session not found");
    expect(deps.openSessionPicker).not.toHaveBeenCalled();
  });

  it("title kind respects the user's custom session name from metadata", async () => {
    // User renamed session to "My payment bug report"; summary is unrelated.
    // The metadata store keys custom names by `session_id` (the app-wide
    // identifier); stub + production must agree on that key.
    const renamedSession: ClaudeSession = {
      ...session,
      summary: "Initial checkout investigation",
    };
    mockStoreState.getSessionDisplayName = (id, fallback) =>
      id === renamedSession.session_id ? "My payment bug report" : fallback;
    vi.mocked(api).mockResolvedValueOnce([renamedSession] as unknown as never);
    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "title",
        value: "payment bug",
      } as SessionHint),
      projects: [project],
    });

    const result = await preloadSessionFromCli(deps);

    expect(result.matched).toBe(true);
    expect(deps.openMatch).toHaveBeenCalledWith(expect.objectContaining({ session: renamedSession }));
  });

  // Race simulation: the user clicks a session while the match is opening.
  // `navigate` notices on its epoch and reports it did not arrive.
  it("reports no match when opening it was superseded on the way", async () => {
    vi.mocked(api).mockResolvedValueOnce([session] as unknown as never);
    const openMatch = vi.fn().mockResolvedValue(false);

    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: UUID,
      } as SessionHint),
      projects: [project],
      openMatch,
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(openMatch).toHaveBeenCalledWith({ project, session });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("skips a resolved match when a newer preload supersedes it", async () => {
    vi.mocked(api).mockResolvedValueOnce([session] as unknown as never);
    let isCurrent = true;
    const openMatch = vi.fn().mockImplementation(async () => {
      // Simulate a newer CLI/deep-link request arriving while the project
      // selection is loading.
      isCurrent = false;
      return true;
    });

    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: UUID,
      } as SessionHint),
      projects: [project],
      openMatch,
      isCurrent: () => isCurrent,
    });

    const result = await preloadSessionFromCli(deps);

    expect(result).toEqual({ handled: true, matched: false });
    expect(openMatch).toHaveBeenCalledWith({ project, session });
    expect(toast.error).not.toHaveBeenCalled();
  });

  // Real race simulation: the user navigates mid-scan. Exercises the
  // per-loop guard inside scan helpers, not just the final guard.
  it("aborts the scan loop when a newer navigation supersedes it mid-scan", async () => {
    const projectA: ClaudeProject = { ...project, name: "a", path: "/a" };
    const projectB: ClaudeProject = { ...project, name: "b", path: "/b" };
    const projectC: ClaudeProject = { ...project, name: "c", path: "/c" };
    let scanCount = 0;
    let current = true;
    vi.mocked(api).mockImplementation(async () => {
      scanCount += 1;
      if (scanCount === 1) {
        // The user navigates while project A's scan is in flight. The NEXT
        // loop iteration should abort before hitting project B.
        current = false;
      }
      return [] as unknown as never; // No match in any project
    });

    const deps = makeDeps({
      getStartupSessionHint: vi.fn().mockResolvedValue({
        kind: "uuid",
        value: UUID,
      } as SessionHint),
      projects: [projectA, projectB, projectC],
      isCurrent: () => current,
    });

    const result = await preloadSessionFromCli(deps);

    // Only project A was scanned. B and C were aborted by the race guard.
    expect(scanCount).toBe(1);
    expect(result).toEqual({ handled: true, matched: false });
    expect(deps.openMatch).not.toHaveBeenCalled();
    // Not a "not found" toast either — user picked something.
    expect(toast.error).not.toHaveBeenCalled();
  });
});
