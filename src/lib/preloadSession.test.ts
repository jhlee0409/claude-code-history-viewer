import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ClaudeProject, ClaudeSession } from "@/types";
import {
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

vi.mock("@/store/useAppStore", () => ({
  useAppStore: {
    getState: () => ({ excludeSidechain: false }),
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
    selectProject: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn().mockResolvedValue(undefined),
    t: (_k: string, fallback?: string) => fallback ?? "Session not found",
    ...overrides,
  };
}

describe("preloadSessionFromCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no-ops when there is no startup hint", async () => {
    const deps = makeDeps();
    const result = await preloadSessionFromCli(deps);
    expect(result).toEqual({ handled: false, matched: false });
    expect(deps.selectProject).not.toHaveBeenCalled();
    expect(deps.selectSession).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
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
    expect(deps.selectProject).toHaveBeenCalledWith(project);
    expect(deps.selectSession).toHaveBeenCalledWith(session);
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
    expect(deps.selectSession).toHaveBeenCalledWith(session);
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
    expect(deps.selectProject).not.toHaveBeenCalled();
    expect(deps.selectSession).not.toHaveBeenCalled();
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
    expect(deps.selectProject).toHaveBeenCalledWith(projectB);
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
});
