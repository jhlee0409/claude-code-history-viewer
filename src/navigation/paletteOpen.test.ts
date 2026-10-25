import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject, ClaudeSession } from "@/types";
import { openMessageResult } from "./paletteOpen";

const { loadSessions, state, toastError } = vi.hoisted(() => {
  const state = {
    projects: [] as ClaudeProject[], sessions: [] as ClaudeSession[],
    selectedProject: null as ClaudeProject | null, excludeSidechain: false,
    navigationEpoch: 0, beginNavigation: () => ++state.navigationEpoch,
    navigate: vi.fn().mockResolvedValue(true),
  };
  return { state, loadSessions: vi.fn(), toastError: vi.fn() };
});
vi.mock("@/store/useAppStore", () => ({ useAppStore: { getState: () => state } }));
vi.mock("@/lib/preloadSession", () => ({ loadSessionsFor: loadSessions }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("./openSessionRef", () => ({ openSessionRef: vi.fn() }));
vi.mock("./tabs", () => ({ openInNewTab: vi.fn() }));

const project = (path: string, provider = "codex"): ClaudeProject => ({
  path, provider, name: "app", actual_path: path, session_count: 1,
  message_count: 1, last_modified: "",
});
const session = (owner: ClaudeProject): ClaudeSession => ({
  session_id: "shared-id", actual_session_id: "shared-id", file_path: `${owner.path}/session`,
  project_name: "app", message_count: 1, first_message_time: "", last_message_time: "",
  last_modified: "", has_tool_use: false, has_errors: false, provider: owner.provider,
});
const hit = (extra: Partial<ClaudeMessage> = {}): ClaudeMessage => ({
  uuid: "message-target", sessionId: "shared-id", projectName: "app", provider: "codex",
  type: "user", timestamp: "", content: "needle", ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.projects = [project("codex:///client-a/app"), project("codex:///client-b/app")];
  state.selectedProject = state.projects[0]!;
  state.sessions = [session(state.projects[0]!)];
  state.navigationEpoch = 0;
  state.navigate.mockResolvedValue(true);
  loadSessions.mockImplementation(async (p: ClaudeProject) => [session(p)]);
});

describe("message result project identity", () => {
  it("opens the exact project even when a loaded session has the same ID", async () => {
    const target = state.projects[1]!;
    expect(await openMessageResult(hit({ projectPath: target.path }))).toBe(true);
    expect(loadSessions).toHaveBeenCalledExactlyOnceWith(target, false);
    expect(state.navigate).toHaveBeenCalledWith(
      { view: "conversation", project: target, session: session(target), messageId: "message-target" }, { epoch: 1 },
    );
  });

  it("reuses a loaded session only when its project and provider match", async () => {
    expect(await openMessageResult(hit({ projectPath: state.selectedProject!.path }))).toBe(true);
    expect(loadSessions).not.toHaveBeenCalled();
    expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-target" }), { epoch: 1 });
  });

  it("never substitutes a same-named project for a missing exact path", async () => {
    expect(await openMessageResult(hit({ projectPath: "codex:///removed/app" }))).toBe(false);
    expect(loadSessions).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("globalSearch.sessionNotFound");
  });

  it("qualifies an exact path by provider and keeps unavailable project locations navigable", async () => {
    const target = project(state.projects[0]!.path, "claude");
    target.path_status = "unavailable";
    state.projects.push(target);
    expect(await openMessageResult(hit({ provider: "claude", projectPath: target.path }))).toBe(true);
    expect(loadSessions).toHaveBeenCalledExactlyOnceWith(target, false);
    expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ project: target }), { epoch: 1 });
  });

  it("retains session lookup for legacy results without a project path", async () => {
    state.sessions = [];
    const target = state.projects[1]!;
    loadSessions.mockImplementation(async (p: ClaudeProject) => p.path === target.path ? [session(p)] : []);
    expect(await openMessageResult(hit())).toBe(true);
    expect(state.navigate).toHaveBeenCalledWith(expect.objectContaining({ project: target }), { epoch: 1 });
  });

  it("does not open another provider's session for a legacy result", async () => {
    state.projects = [project("/store/app", "claude")];
    state.selectedProject = state.projects[0]!;
    state.sessions = [session(state.projects[0]!)];
    expect(await openMessageResult(hit())).toBe(false);
    expect(loadSessions).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("abandons exact-path lookup when a later navigation takes ownership", async () => {
    loadSessions.mockImplementation(async (p: ClaudeProject) => {
      state.navigationEpoch++;
      return [session(p)];
    });
    expect(await openMessageResult(hit({ projectPath: state.projects[1]!.path }))).toBe(false);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
