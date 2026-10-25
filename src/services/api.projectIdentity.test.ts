import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeProject } from "@/types";
import { buildMessageSearchRequest } from "@/components/modals/globalSearch/usePaletteMessageSearch";
import { api } from "./api";

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/store/useAppStore", () => ({ useAppStore: vi.fn() }));
vi.mock("@/utils/platform", () => ({
  isTauri, getApiBase: () => "http://localhost:5173", getAuthToken: () => null,
  getCsrfToken: () => null, setAuthToken: vi.fn(), clearAuthToken: vi.fn(), clearAuthCookie: vi.fn(),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe.each([true, false])("project identity through API adapter (Tauri=%s)", (desktop) => {
  it.each(["claude", "codex"])("preserves %s scope and result paths", async (provider) => {
    isTauri.mockReturnValue(desktop);
    const path = provider === "codex" ? "codex:///client-b/app" : "/custom/.claude/projects/app";
    const project: ClaudeProject = { path, provider, name: "app", actual_path: path,
      session_count: 1, message_count: 1, last_modified: "" };
    const request = buildMessageSearchRequest({ query: "needle", scope: "project", messageType: "all", project }, {
      claudePath: "/home/.claude", activeProviders: [provider], customClaudePaths: undefined,
      wslEnabled: false, wslExcludedDistros: [],
    })!;
    const response: ClaudeMessage[] = [{ uuid: "m", sessionId: "s", provider, projectName: "app", projectPath: path,
      timestamp: "", type: "user", content: "needle" }];
    invoke.mockResolvedValue(response);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await api<ClaudeMessage[]>(request.command, request.args)).toEqual(response);
    expect(request.args.filters).toEqual({ projectPaths: [path] });
    if (desktop) {
      expect(invoke).toHaveBeenCalledExactlyOnceWith(request.command, request.args);
      expect(fetch).not.toHaveBeenCalled();
    } else {
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`http://localhost:5173/api/${request.command}`, expect.objectContaining({
        method: "POST", body: JSON.stringify(request.args),
      }));
      expect(invoke).not.toHaveBeenCalled();
    }
  });
});
