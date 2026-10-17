/**
 * The ⌘K palette's place sources (plan T10): which projects and sessions a
 * query finds, in which order, where the match is, and which providers'
 * messages the message search cannot reach.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaudeProject, ClaudeSession, ProviderId } from "@/types";
import type { RecentEntry, FavoriteEntry } from "@/navigation/library";
import { PROVIDER_IDS } from "@/utils/providers";
import {
  MESSAGE_SEARCH_PROVIDERS,
  matchProjects,
  matchRanges,
  matchSessions,
  sessionCandidates,
  unsearchableProviders,
} from "./paletteSources";

const project = (name: string, extra: Partial<ClaudeProject> = {}): ClaudeProject => ({
  name,
  path: `/store/${name}`,
  actual_path: `/home/me/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "2026-01-01T00:00:00Z",
  provider: "claude",
  ...extra,
});

const session = (id: string, summary: string, extra: Partial<ClaudeSession> = {}): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `/store/alpha/${id}.jsonl`,
  project_name: "alpha",
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "2026-01-01T00:00:00Z",
  has_tool_use: false,
  has_errors: false,
  summary,
  provider: "claude",
  ...extra,
});

describe("matchRanges", () => {
  it("marks every occurrence of every query word, case-insensitively", () => {
    expect(matchRanges("Fix the login bug in Login.tsx", "login")).toEqual([
      [8, 13],
      [21, 26],
    ]);
    expect(matchRanges("alpha beta", "BETA al")).toEqual([
      [0, 2],
      [6, 10],
    ]);
  });

  it("merges overlapping words and ignores an empty query", () => {
    expect(matchRanges("abcdef", "abc bcd")).toEqual([[0, 4]]);
    expect(matchRanges("abc", "  ")).toEqual([]);
  });

  it("finds CJK words inside a run without spaces", () => {
    expect(matchRanges("로그인 버그 수정", "버그")).toEqual([[4, 6]]);
  });
});

describe("matchProjects", () => {
  const projects = [
    project("web-app", { last_modified: "2026-01-03T00:00:00Z" }),
    project("my-web", { last_modified: "2026-01-05T00:00:00Z" }),
    project("api", { last_modified: "2026-01-04T00:00:00Z" }),
    project("hidden-web", { last_modified: "2026-01-09T00:00:00Z" }),
  ];
  const isHidden = (p: ClaudeProject) => p.name === "hidden-web";

  it("finds projects whose name holds every word; a name that starts with it first", () => {
    const hits = matchProjects("web", projects, isHidden).map((h) => h.project.name);
    expect(hits).toEqual(["web-app", "my-web"]);
  });

  it("matches the decoded path too, and finds nothing for an empty query", () => {
    expect(matchProjects("home/me/api", projects, isHidden).map((h) => h.project.name)).toEqual(["api"]);
    expect(matchProjects("   ", projects, isHidden)).toEqual([]);
  });

  it("orders equally good matches by most recent activity", () => {
    const hits = matchProjects("e", [project("re-b", { last_modified: "2026-01-01T00:00:00Z" }), project("re-a", { last_modified: "2026-02-01T00:00:00Z" })], () => false);
    expect(hits.map((h) => h.project.name)).toEqual(["re-a", "re-b"]);
  });

  it("labels a project with its display name (the decoded folder for Claude Code)", () => {
    const [hit] = matchProjects("client", [project("-Users-me-client", { actual_path: "/Users/me/client" })], () => false);
    expect(hit?.label).toBe("client");
  });
});

describe("sessionCandidates + matchSessions", () => {
  const alpha = project("alpha");
  const beta = project("beta");
  const loaded = [session("s1", "Fix login bug"), session("s2", "Write docs")];
  const recent: RecentEntry[] = [
    { ref: { provider: "claude", filePath: "/store/beta/r1.jsonl", sessionId: "r1", projectPath: beta.path }, title: "Login page redesign", openedAt: 2 },
    // Already listed (open project): not twice.
    { ref: { provider: "claude", filePath: "/store/alpha/s1.jsonl", sessionId: "s1", projectPath: alpha.path }, title: "Fix login bug", openedAt: 1 },
  ];
  const favorites: FavoriteEntry[] = [
    { sessionId: "f1", ref: { provider: "codex", filePath: "/codex/f1.jsonl", sessionId: "f1", projectPath: "codex:///w/gamma" }, customName: "Login flow notes" },
    // A legacy star (no ref) cannot be opened from here.
    { sessionId: "legacy", ref: null, customName: "Login legacy" },
  ];
  const base = {
    sessions: loaded,
    selectedProject: alpha,
    recent,
    favorites,
    projects: [alpha, beta, project("gamma", { path: "codex:///w/gamma", provider: "codex", name: "gamma" })],
    titleOf: (sessionId: string, fallback: string) => (sessionId === "s2" ? "Docs (renamed)" : fallback),
  };

  it("scope 'project': only the open project's loaded sessions, with their display titles", () => {
    const candidates = sessionCandidates({ ...base, scope: "project" });
    expect(candidates.map((c) => c.title)).toEqual(["Fix login bug", "Docs (renamed)"]);
    expect(candidates[0]?.target).toEqual({ kind: "loaded", session: loaded[0], project: alpha });
  });

  it("scope 'all': adds recent and starred sessions of other projects, each file once", () => {
    const candidates = sessionCandidates({ ...base, scope: "all" });
    expect(candidates.map((c) => c.key)).toEqual([
      "/store/alpha/s1.jsonl",
      "/store/alpha/s2.jsonl",
      "/store/beta/r1.jsonl",
      "/codex/f1.jsonl",
    ]);
    expect(candidates[2]?.target).toEqual({ kind: "ref", ref: recent[0]!.ref });
    expect(candidates[2]?.projectLabel).toBe("beta");
    expect(candidates[3]?.provider).toBe("codex");
    expect(candidates[3]?.projectLabel).toBe("gamma");
  });

  it("finds sessions by every query word in the title, title starts first", () => {
    const candidates = sessionCandidates({ ...base, scope: "all" });
    expect(matchSessions("login", candidates).map((c) => c.title)).toEqual([
      "Login page redesign",
      "Login flow notes",
      "Fix login bug",
    ]);
    expect(matchSessions("login bug", candidates).map((c) => c.title)).toEqual(["Fix login bug"]);
    expect(matchSessions("", candidates)).toEqual([]);
  });

  it("scope 'project' on a project scoped with Tab: its loaded list, then its own recent and starred sessions", () => {
    const betaLoaded = [{ ...session("b1", "Beta docs"), file_path: "/store/beta/b1.jsonl" }];
    const candidates = sessionCandidates({ ...base, scope: "project", selectedProject: beta, sessions: betaLoaded });
    expect(candidates.map((c) => c.key)).toEqual(["/store/beta/b1.jsonl", "/store/beta/r1.jsonl"]);
    expect(candidates[0]?.target).toEqual({ kind: "loaded", session: betaLoaded[0], project: beta });
    expect(candidates[1]?.target).toEqual({ kind: "ref", ref: recent[0]!.ref });
    // Before its list lands, the library alone.
    expect(sessionCandidates({ ...base, scope: "project", selectedProject: beta, sessions: [] }).map((c) => c.key)).toEqual([
      "/store/beta/r1.jsonl",
    ]);
  });

  it("scope 'project' matches library refs by provider and path, not by folder name", () => {
    const codexBeta = project("beta", { provider: "codex", path: "codex:///w/beta" });
    expect(sessionCandidates({ ...base, scope: "project", selectedProject: codexBeta, sessions: [] })).toEqual([]);
  });

  it("without an open project, scope 'project' lists nothing", () => {
    expect(sessionCandidates({ ...base, selectedProject: null, sessions: [], scope: "project" })).toEqual([]);
  });
});

describe("message search coverage (provider parity)", () => {
  it("names the providers with listed projects whose messages the search cannot reach", () => {
    const listed = [
      project("a", { provider: "claude" }),
      project("b", { provider: "codex", custom_directory_label: "WSL: Ubuntu" }),
      project("c", { provider: "copilot", custom_directory_label: "WSL: Ubuntu" }),
    ];
    // WSL search covers Claude Code and Copilot only.
    expect(unsearchableProviders(listed)).toEqual(["codex"]);
    expect(unsearchableProviders([project("d", { provider: "codex" })])).toEqual([]);
  });

  it("covers every provider the app lists", () => {
    expect([...MESSAGE_SEARCH_PROVIDERS].sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("matches the providers `search_all_providers` actually searches (Rust)", () => {
    const rust = readFileSync(
      path.resolve(__dirname, "../../src-tauri/src/commands/multi_provider.rs"),
      "utf8",
    );
    const start = rust.indexOf("pub async fn search_all_providers(");
    const end = rust.indexOf("\n}\n", start);
    expect(start).toBeGreaterThan(-1);
    const body = rust.slice(start, end);
    const searched = new Set(
      Array.from(body.matchAll(/providers_to_search\.iter\(\)\.any\(\|p\| p == "([a-z-]+)"\)/g), (m) => m[1] as ProviderId),
    );
    expect([...searched].sort()).toEqual([...MESSAGE_SEARCH_PROVIDERS].sort());
  });
});
