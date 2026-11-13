import { describe, it, expect } from "vitest";
import type { ClaudeProject, ClaudeSession } from "@/types";
import {
  computeSidebarMatches,
  normalizeSidebarQuery,
  sessionMatchesQuery,
} from "./sidebarFilter";

const project = (name: string, path = `/p/${name}`): ClaudeProject =>
  ({ name, path, session_count: 0, message_count: 0, last_modified: "2026-01-01T00:00:00Z" }) as ClaudeProject;

const session = (session_id: string, summary?: string): ClaudeSession =>
  ({ session_id, summary, file_path: `/f/${session_id}.jsonl` }) as ClaudeSession;

const BOTH = { matchProjects: true, matchSessions: true };
const PROJECTS_ONLY = { matchProjects: true, matchSessions: false };
const SESSIONS_ONLY = { matchProjects: false, matchSessions: true };

describe("sidebarFilter", () => {
  const web = project("web-app");
  const api = project("api-server");
  const sessions = new Map([
    [web.path, [session("s1", "Fix login bug"), session("s2", "Refactor api client")]],
    [api.path, [session("s3", "Add rate limiting")]],
  ]);

  it("normalizes the query", () => {
    expect(normalizeSidebarQuery("  LoGin ")).toBe("login");
  });

  it("keeps every project when the query is empty", () => {
    const result = computeSidebarMatches([web, api], "", SESSIONS_ONLY, sessions, {});
    expect([...result.projectPaths]).toEqual([web.path, api.path]);
    expect(result.sessionMatchesByProject.size).toBe(0);
  });

  it("matches only project names when session names are off", () => {
    const result = computeSidebarMatches([web, api], "login", PROJECTS_ONLY, sessions, {});
    expect(result.projectPaths.size).toBe(0);
  });

  it("matches session names across projects and records which sessions matched", () => {
    const result = computeSidebarMatches([web, api], "login", SESSIONS_ONLY, sessions, {});
    expect([...result.projectPaths]).toEqual([web.path]);
    expect(result.sessionMatchesByProject.get(web.path)?.map((s) => s.session_id)).toEqual(["s1"]);
  });

  it("ORs both targets and keeps all sessions of a project matched by name", () => {
    const result = computeSidebarMatches([web, api], "api", BOTH, sessions, {});
    // api-server matches by name; web-app only through its "Refactor api client" session.
    expect(new Set(result.projectPaths)).toEqual(new Set([web.path, api.path]));
    expect(result.sessionMatchesByProject.has(api.path)).toBe(false);
    expect(result.sessionMatchesByProject.get(web.path)?.map((s) => s.session_id)).toEqual(["s2"]);
  });

  it("does not match project names when only session names are on", () => {
    const result = computeSidebarMatches([web, api], "server", SESSIONS_ONLY, sessions, {});
    expect(result.projectPaths.size).toBe(0);
  });

  it("matches the app-only custom session name", () => {
    expect(sessionMatchesQuery(session("s9", "Untitled"), "deploy", { s9: { customName: "Deploy script" } })).toBe(true);
    expect(sessionMatchesQuery(session("s9", "Untitled"), "deploy", {})).toBe(false);
  });
});
