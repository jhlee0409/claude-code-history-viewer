import { describe, expect, it } from "vitest";

import type { ClaudeProject, ClaudeSession } from "@/types";
import { findProjectForSession } from "@/utils/projectMatch";

function makeProject(overrides: Partial<ClaudeProject>): ClaudeProject {
  return {
    name: "project",
    path: "/tmp/project",
    actual_path: "/tmp/project",
    session_count: 1,
    message_count: 1,
    last_modified: "2026-07-21T00:00:00Z",
    ...overrides,
  } as ClaudeProject;
}

function makeSession(
  overrides: Partial<ClaudeSession>
): Pick<ClaudeSession, "file_path" | "project_name" | "provider"> {
  return {
    file_path: "/tmp/project/session.jsonl",
    project_name: "project",
    provider: "claude",
    ...overrides,
  };
}

describe("findProjectForSession", () => {
  it("matches a plain-path Claude session by path prefix", () => {
    const project = makeProject({ path: "/Users/dev/repo", provider: "claude" });
    const session = makeSession({
      file_path: "/Users/dev/repo/abc.jsonl",
      provider: "claude",
    });
    expect(findProjectForSession([project], session)).toBe(project);
  });

  it("does not match sibling paths sharing a parent prefix", () => {
    const project = makeProject({ path: "/a/proj", provider: "claude" });
    const session = makeSession({
      file_path: "/a/proj2/abc.jsonl",
      project_name: "other",
      provider: "claude",
    });
    expect(findProjectForSession([project], session)).toBeUndefined();
  });

  it("resolves a kimi-code session to its own project despite a same-named Claude project", () => {
    const claudeProject = makeProject({
      name: "claude-code-history-viewer",
      path: "/Users/dev/.claude/projects/-Users-dev-claude-code-history-viewer",
      provider: "claude",
    });
    const kimiCodeProject = makeProject({
      name: "claude-code-history-viewer",
      path: "kimicode:///Users/dev/.kimi-code/sessions/wd_claude-code-history-viewer_a1b2c3d4e5f6",
      provider: "kimi-code",
    });
    const session = makeSession({
      file_path:
        "/Users/dev/.kimi-code/sessions/wd_claude-code-history-viewer_a1b2c3d4e5f6/session_1111",
      project_name: "claude-code-history-viewer",
      provider: "kimi-code",
    });

    // The Claude project is listed first (sorted by recency) — a name-only
    // fallback would jump providers and hide the Kimi Code session list.
    expect(
      findProjectForSession([claudeProject, kimiCodeProject], session)
    ).toBe(kimiCodeProject);
  });

  it("resolves a legacy kimi session to its own project despite a same-named Claude project", () => {
    const claudeProject = makeProject({
      name: "repo",
      path: "/Users/dev/.claude/projects/-Users-dev-repo",
      provider: "claude",
    });
    const kimiProject = makeProject({
      name: "repo",
      path: "kimi:///Users/dev/.kimi/sessions/deadbeef",
      provider: "kimi",
    });
    const session = makeSession({
      file_path: "/Users/dev/.kimi/sessions/deadbeef/session_1",
      project_name: "repo",
      provider: "kimi",
    });

    expect(findProjectForSession([claudeProject, kimiProject], session)).toBe(
      kimiProject
    );
  });

  it("matches opencode sessions whose file_path carries the scheme", () => {
    const project = makeProject({
      path: "opencode://storage-1",
      provider: "opencode",
    });
    const session = makeSession({
      file_path: "opencode://storage-1/session-9",
      provider: "opencode",
    });
    expect(findProjectForSession([project], session)).toBe(project);
  });

  it("falls back to name equality within the same provider only", () => {
    const claudeProject = makeProject({ name: "repo", provider: "claude" });
    const codexProject = makeProject({
      name: "repo",
      path: "codex:///Users/dev/repo",
      provider: "codex",
    });
    const session = makeSession({
      // Codex rollouts live under ~/.codex, unreachable from the cwd path.
      file_path: "/Users/dev/.codex/sessions/2026/07/rollout-1.jsonl",
      project_name: "repo",
      provider: "codex",
    });

    expect(findProjectForSession([claudeProject, codexProject], session)).toBe(
      codexProject
    );
  });

  it("returns undefined when nothing matches", () => {
    const project = makeProject({ name: "repo", provider: "claude" });
    const session = makeSession({
      file_path: "/elsewhere/abc.jsonl",
      project_name: "other",
      provider: "claude",
    });
    expect(findProjectForSession([project], session)).toBeUndefined();
  });
});
