import { describe, expect, it } from "vitest";
import type { ClaudeMessage, ClaudeProject, ClaudeSession } from "@/types";
import { buildSidebarSearchScope, isResultInScope, isSessionRefInScope } from "./searchScope";
import { buildMessageSearchRequest } from "./usePaletteMessageSearch";

const project = (name: string, provider = "claude"): ClaudeProject => ({
  name,
  path: provider === "claude" ? `/store/${name}` : `${provider}:///home/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider,
});
const session = (id: string): ClaudeSession => ({ session_id: id, actual_session_id: `real-${id}` }) as ClaudeSession;
const result = (projectName: string, sessionId: string, provider = "claude"): ClaudeMessage =>
  ({ uuid: "u", sessionId, projectName, provider, timestamp: "", type: "user" }) as unknown as ClaudeMessage;

const web = project("web");
const api = project("api");
const notes = project("notes");
const ALL = [web, api, notes];

// "login": web by its own name, api only for its session a1.
const filterResult = (sessionIds: string[] | null) => ({
  projectPaths: [web.path, api.path],
  sessionMatchesByProject: { [api.path]: [session("a1")] },
  sessionIds,
});

describe("buildSidebarSearchScope", () => {
  it("is null without a filter or when the filter shows nothing", () => {
    expect(buildSidebarSearchScope(ALL, null)).toBeNull();
    expect(
      buildSidebarSearchScope(ALL, { projectPaths: [], sessionMatchesByProject: {}, sessionIds: null })
    ).toBeNull();
  });

  it("keeps the shown projects and the session id list", () => {
    const scope = buildSidebarSearchScope(ALL, filterResult(["w1", "a1"]))!;
    expect(scope.projects).toEqual([web, api]);
    expect(scope.sessionIds).toEqual(["w1", "a1"]);
  });
});

describe("isResultInScope", () => {
  it("keeps every session of a name-matched project and only the matched ones otherwise", () => {
    const scope = buildSidebarSearchScope(ALL, filterResult(null))!;
    expect(isResultInScope(result("web", "anything"), scope, ALL)).toBe(true);
    expect(isResultInScope(result("api", "a1"), scope, ALL)).toBe(true);
    expect(isResultInScope(result("api", "real-a1"), scope, ALL)).toBe(true);
    expect(isResultInScope(result("api", "a2"), scope, ALL)).toBe(false);
    expect(isResultInScope(result("notes", "n1"), scope, ALL)).toBe(false);
  });

  it("judges a result of an unknown project by the session id list, if any", () => {
    expect(isResultInScope(result("elsewhere", "x"), buildSidebarSearchScope(ALL, filterResult(null))!, ALL)).toBe(true);
    const withIds = buildSidebarSearchScope(ALL, filterResult(["w1", "a1"]))!;
    expect(isResultInScope(result("elsewhere", "x"), withIds, ALL)).toBe(false);
    expect(isResultInScope(result("elsewhere", "w1"), withIds, ALL)).toBe(true);
  });

  it("resolves a path-qualified result to its own project, not a same-named one", () => {
    const inView = { ...project("app"), path: "/store-a/app" };
    const hidden = { ...project("app"), path: "/store-b/app" };
    const projects = [inView, hidden];
    const scope = buildSidebarSearchScope(projects, {
      projectPaths: [inView.path],
      sessionMatchesByProject: {},
      sessionIds: null,
    })!;
    const at = (projectPath: string) => ({ ...result("app", "s1"), projectPath }) as ClaudeMessage;
    expect(isResultInScope(at(inView.path), scope, projects)).toBe(true);
    expect(isResultInScope(at(hidden.path), scope, projects)).toBe(false);
  });
});

describe("isSessionRefInScope", () => {
  it("applies the same per-project rule to sessions", () => {
    const scope = buildSidebarSearchScope(ALL, filterResult(null))!;
    const ref = (projectPath: string, sessionId: string) => ({ provider: "claude", filePath: "f", sessionId, projectPath });
    expect(isSessionRefInScope(ref(web.path, "w9"), scope)).toBe(true);
    expect(isSessionRefInScope(ref(api.path, "a1"), scope)).toBe(true);
    expect(isSessionRefInScope(ref(api.path, "a2"), scope)).toBe(false);
    expect(isSessionRefInScope(ref(notes.path, "n1"), scope)).toBe(false);
  });
});

describe("buildMessageSearchRequest with the sidebar scope", () => {
  const config = {
    claudePath: "/home/.claude",
    activeProviders: ["claude", "codex"],
    wslEnabled: false,
    wslExcludedDistros: [],
  };
  const base = { query: "deploy", scope: "all" as const, messageType: "all" as const, project: null };

  it("sends the shown projects and session ids, and asks only their providers", () => {
    const restrict = buildSidebarSearchScope(ALL, filterResult(["w1", "a1"]))!;
    const request = buildMessageSearchRequest({ ...base, restrict }, config)!;
    expect(request.command).toBe("search_messages");
    expect(request.args.filters).toEqual({ projectPaths: [web.path, api.path], sessionIds: ["w1", "a1"] });
  });

  it("selects same-named projects of a non-Claude provider by their own paths", () => {
    const a = { ...project("app", "opencode"), path: "opencode://proj-a" };
    const b = { ...project("app", "opencode"), path: "opencode://proj-b" };
    const restrict = buildSidebarSearchScope([a, b], {
      projectPaths: [b.path],
      sessionMatchesByProject: {},
      sessionIds: null,
    })!;
    const request = buildMessageSearchRequest({ ...base, restrict }, { ...config, activeProviders: ["opencode"] })!;
    expect(request.args).toMatchObject({ activeProviders: ["opencode"], filters: { projectPaths: [b.path] } });
  });

  it("is ignored under the project scope", () => {
    const restrict = buildSidebarSearchScope(ALL, filterResult(["w1"]))!;
    const request = buildMessageSearchRequest({ ...base, scope: "project", project: notes, restrict }, config)!;
    expect(request.args.filters).toEqual({ projectPaths: [notes.path] });
  });
});
