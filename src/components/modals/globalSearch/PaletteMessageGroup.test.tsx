import { render, screen, waitFor } from "@testing-library/react";
import { Command } from "cmdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject } from "@/types";
import { PaletteMessageGroup } from "./PaletteMessageGroup";

const { mockApi, state } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  state: { projects: [] as ClaudeProject[], excludeSidechain: false, getSessionDisplayName: () => undefined },
}));
vi.mock("@/services/api", () => ({ api: mockApi }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: Object.assign(() => state, { getState: () => state }) }));
vi.mock("react-i18next", () => {
  const value = { t: (key: string, fallback?: unknown) => typeof fallback === "string" ? fallback : key, i18n: { language: "en" } };
  return { useTranslation: () => value };
});
vi.mock("@/lib/format/useFormat", () => ({ useFormat: () => ({ count: String, dateTime: () => "date" }) }));

const project = (path: string, provider = "codex", actualPath = path.replace(/^codex:\/\//, "")): ClaudeProject => ({
  path, provider, name: "app", actual_path: actualPath, session_count: 1, message_count: 1,
  last_modified: "2026-08-13T00:00:00Z",
});
const hit = (uuid: string, projectPath?: string, provider = "codex"): ClaudeMessage => ({
  uuid, projectPath, provider, projectName: "app", sessionId: "shared-id",
  timestamp: "2026-08-13T00:00:00Z", type: "user", content: `needle ${uuid}`,
});
const show = (results: ClaudeMessage[]) => render(
  <Command shouldFilter={false}><Command.List>
    <PaletteMessageGroup view={{ status: "done", query: "needle", results }} expanded
      onExpand={vi.fn()} onOpen={vi.fn()} onRetry={vi.fn()} notSearched={[]} />
  </Command.List></Command>,
);

beforeEach(() => { vi.clearAllMocks(); state.projects = []; });

describe("palette message project identity", () => {
  it("separates same-named groups and loads each project's own session title", async () => {
    const first = project("codex:///client-a/app");
    const second = project("codex:///client-b/app");
    state.projects = [first, second];
    mockApi.mockImplementation(async (_command: string, args: { projectPath: string }) => [
      { session_id: "shared-id", summary: args.projectPath === first.path ? "First project title" : "Second project title" },
    ]);
    show([hit("one", first.path), hit("two", second.path)]);
    expect(await screen.findByText("First project title")).toBeInTheDocument();
    expect(await screen.findByText("Second project title")).toBeInTheDocument();
    expect(screen.getAllByText("app (Codex CLI)")).toHaveLength(2);
    // Colliding labels are told apart by the readable folder, not the URI.
    expect(screen.getByText("/client-a/app")).toBeInTheDocument();
    expect(screen.getByText("/client-b/app")).toBeInTheDocument();
    expect(screen.queryByText(first.path)).not.toBeInTheDocument();
    expect(screen.queryByText(second.path)).not.toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledWith("load_provider_sessions", { provider: "codex", projectPath: first.path, excludeSidechain: false });
    expect(mockApi).toHaveBeenCalledWith("load_provider_sessions", { provider: "codex", projectPath: second.path, excludeSidechain: false });
  });

  it("shows no location under a group whose label is unique", async () => {
    const store = "/Users/me/.claude/projects/-work-app";
    state.projects = [project(store, "claude", "/work/app")];
    mockApi.mockResolvedValue([]);
    show([hit("only", store, "claude")]);
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("needle only"));
    expect(screen.getByText("app (Claude Code)").parentElement).toHaveAttribute("title", store);
    expect(screen.queryByText(store)).not.toBeInTheDocument();
    expect(screen.queryByText("/work/app")).not.toBeInTheDocument();
  });

  it("falls back to the identity when the readable folders collide too", async () => {
    const first = "/Users/me/.claude/projects/-work-app";
    const second = "/Volumes/backup/.claude/projects/-work-app";
    state.projects = [project(first, "claude", "/work/app"), project(second, "claude", "/work/app")];
    mockApi.mockResolvedValue([]);
    show([hit("one", first, "claude"), hit("two", second, "claude")]);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getAllByText("app (Claude Code)")).toHaveLength(2);
    expect(screen.getByText(first)).toBeInTheDocument();
    expect(screen.getByText(second)).toBeInTheDocument();
  });

  it("qualifies title caches by provider even when paths and session IDs match", async () => {
    const path = "/provider-shared/app";
    state.projects = [project(path, "codex"), project(path, "claude")];
    mockApi.mockImplementation(async (command: string) => [
      { session_id: "shared-id", summary: command === "load_provider_sessions" ? "Codex title" : "Claude title" },
    ]);
    show([hit("codex", path), hit("claude", path, "claude")]);
    expect(await screen.findByText("Codex title")).toBeInTheDocument();
    expect(await screen.findByText("Claude title")).toBeInTheDocument();
  });

  it("does not assign the first same-named project's title to an ambiguous legacy hit", async () => {
    state.projects = [project("codex:///legacy-a/app"), project("codex:///legacy-b/app")];
    mockApi.mockResolvedValue([{ session_id: "shared-id", summary: "Wrong first project" }]);
    show([hit("legacy")]);
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("needle legacy"));
    expect(mockApi).not.toHaveBeenCalled();
    expect(screen.queryByText("Wrong first project")).not.toBeInTheDocument();
  });

  it("still resolves a unique legacy name", async () => {
    state.projects = [project("codex:///unique-legacy/app")];
    mockApi.mockResolvedValue([{ session_id: "shared-id", summary: "Unique legacy title" }]);
    show([hit("legacy-unique")]);
    expect(await screen.findByText("Unique legacy title")).toBeInTheDocument();
  });
});
