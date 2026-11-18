import { describe, it, expect } from "vitest";
import type { ClaudeProject, ClaudeSession } from "@/types";
import {
  collectScopedSessionIds,
  compileSidebarQuery,
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
    const deploy = compileSidebarQuery("deploy");
    expect(sessionMatchesQuery(session("s9", "Untitled"), deploy, { s9: { customName: "Deploy script" } })).toBe(true);
    expect(sessionMatchesQuery(session("s9", "Untitled"), deploy, {})).toBe(false);
  });

  describe("fuzzy names", () => {
    const viewer = project("claude-code-history-viewer", "/work/claude-code-history-viewer");
    const other = project("dotfiles", "/work/dotfiles");
    const otherSessions = new Map([
      [other.path, [session("abcd-1234", "Refactor history pagination"), session("s5", "Update zsh aliases")]],
    ]);

    it("matches a project name by its abbreviation", () => {
      const result = computeSidebarMatches([viewer, other], "cchv", BOTH, otherSessions, {});
      expect([...result.projectPaths]).toEqual([viewer.path]);
      expect(result.sessionMatchesByProject.has(viewer.path)).toBe(false);
    });

    it("matches session names with a typo and narrows to those sessions", () => {
      const result = computeSidebarMatches([viewer, other], "histroy", BOTH, otherSessions, {});
      expect(new Set(result.projectPaths)).toEqual(new Set([viewer.path, other.path]));
      expect(result.sessionMatchesByProject.get(other.path)?.map((s) => s.session_id)).toEqual(["abcd-1234"]);
    });

    it("matches the custom session name fuzzily", () => {
      const custom = { s5: { customName: "Shell configuration" } };
      expect(sessionMatchesQuery(session("s5", "Untitled"), compileSidebarQuery("shel confg"), custom)).toBe(true);
    });

    it("keeps paths and session ids to exact substrings", () => {
      // "work" only appears in the paths; a typo of it must not match.
      expect(computeSidebarMatches([viewer, other], "wrok", PROJECTS_ONLY, otherSessions, {}).projectPaths.size).toBe(0);
      expect(computeSidebarMatches([other], "abdc-1234", SESSIONS_ONLY, otherSessions, {}).projectPaths.size).toBe(0);
      expect(computeSidebarMatches([other], "abcd-1234", SESSIONS_ONLY, otherSessions, {}).projectPaths.size).toBe(1);
    });

    it("only adds matches: everything a substring finds is still found", () => {
      const projects = [viewer, other, web, api];
      const all = new Map([...sessions, ...otherSessions]);
      for (const query of ["api", "his", "-code-", "login", "s5", "work/d", "refactor h", "zsh"]) {
        const result = computeSidebarMatches(projects, query, BOTH, all, {});
        for (const p of projects) {
          const nameHit = p.name.toLowerCase().includes(query) || p.path.toLowerCase().includes(query);
          const sessionHits = (all.get(p.path) ?? []).filter(
            (s) => s.session_id.includes(query) || (s.summary ?? "").toLowerCase().includes(query)
          );
          if (nameHit) {
            expect(result.projectPaths.has(p.path), `${query} → ${p.name}`).toBe(true);
            expect(result.sessionMatchesByProject.has(p.path)).toBe(false);
          } else if (sessionHits.length > 0) {
            expect(result.sessionMatchesByProject.get(p.path), `${query} → ${p.name}`).toEqual(
              expect.arrayContaining(sessionHits)
            );
          }
        }
      }
    });

    it("scopes message search to fuzzily matched sessions", () => {
      const matches = computeSidebarMatches([viewer, other], "histroy", SESSIONS_ONLY, otherSessions, {});
      expect(collectScopedSessionIds(matches, otherSessions)).toEqual(["abcd-1234"]);
    });

    it("filters thousands of sessions quickly", () => {
      const vocabulary = [
        "fix", "login", "bug", "refactor", "api", "client", "add", "rate", "limiting", "update",
        "dependencies", "write", "tests", "for", "session", "parser", "migrate", "database", "schema",
        "improve", "sidebar", "performance", "investigate", "flaky", "build", "deploy", "staging",
      ];
      let seed = 7;
      const nextWord = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return vocabulary[seed % vocabulary.length] as string;
      };
      const manyProjects = Array.from({ length: 200 }, (_, i) =>
        project(`${nextWord()}-${nextWord()}-service-${i}`, `/Users/dev/work/${nextWord()}-repo-${i}`)
      );
      const manySessions = new Map(
        manyProjects.map((p, i) => [
          p.path,
          Array.from({ length: 50 }, (_, j) =>
            session(`${i}-${j}-${seed.toString(16)}`, Array.from({ length: 9 }, nextWord).join(" "))
          ),
        ])
      );
      // 10,000 sessions; queries that miss every substring take the slow path.
      const queries = ["cchv", "histroy", "zzzzzz", "fix bug", "perfromance sidebar", "rlmt", "ab"];
      computeSidebarMatches(manyProjects, "warm", BOTH, manySessions, {});
      const start = performance.now();
      for (const query of queries) {
        computeSidebarMatches(manyProjects, query, BOTH, manySessions, {});
      }
      const perQuery = (performance.now() - start) / queries.length;
      expect(perQuery).toBeLessThan(150);
    });
  });

  describe("collectScopedSessionIds", () => {
    it("takes every session of a project matched by name and only the matching ones otherwise", () => {
      const matches = computeSidebarMatches([web, api], "api", BOTH, sessions, {});
      expect(new Set(collectScopedSessionIds(matches, sessions))).toEqual(new Set(["s2", "s3"]));
    });

    it("includes actual_session_id, which messages carry", () => {
      const withActual = new Map([[web.path, [{ ...session("s1", "login"), actual_session_id: "real-1" }]]]);
      const matches = computeSidebarMatches([web], "login", SESSIONS_ONLY, withActual, {});
      expect(collectScopedSessionIds(matches, withActual)).toEqual(["s1", "real-1"]);
    });

    it("gives up (null) while a name-matched project's sessions are not loaded", () => {
      const matches = computeSidebarMatches([web, api], "api", BOTH, new Map(), {});
      expect(collectScopedSessionIds(matches, new Map())).toBeNull();
    });
  });
});
