import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

const runtime = vi.hoisted(() => ({ tauri: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));
vi.mock("@/utils/platform", () => ({
  isTauri: () => runtime.tauri,
  getApiBase: () => "https://remote-server.test",
  getAuthToken: () => "test-fixture-token",
  getCsrfToken: () => null,
  setAuthToken: vi.fn(), clearAuthToken: vi.fn(), clearAuthCookie: vi.fn(),
}));
const legacy = { user: "{}", project: null, local: "null", managed: "42" };
const unknown = { path: null, state: "unknown", readOnly: null };

for (const tauri of [true, false]) {
  describe(tauri ? "Tauri settings metadata" : "HTTP settings metadata", () => {
    beforeEach(() => { runtime.tauri = tauri; });
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
    function respond(value: unknown) {
      runtime.invoke.mockResolvedValue(value);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => value }));
    }
    it("keeps old contents but marks metadata unknown without inventing browser paths", async () => {
      respond(legacy);
      const result = await api<Record<string, unknown>>("get_all_settings", { projectPath: "/server/project" });
      expect(result).toEqual({ ...legacy, metadata: { serverHome: null, scopes: {
        user: unknown, project: unknown, local: unknown, managed: unknown,
      } } });
      expect(legacy).not.toHaveProperty("metadata");
    });
    it("preserves authoritative remote metadata and the same transport arguments", async () => {
      const metadata = { serverHome: "C:\\server-home", scopes: {
        user: { path: "C:\\server-home\\.claude\\settings.json", state: "present", readOnly: false },
        project: { path: "/canonical/project/.claude/settings.json", state: "missing", readOnly: false },
        local: { path: "/canonical/project/.claude/settings.local.json", state: "read_error", readOnly: false },
        managed: { path: null, state: "unsupported", readOnly: true },
      } };
      respond({ ...legacy, metadata });
      expect(await api("get_all_settings", { projectPath: "/server/project" })).toEqual({ ...legacy, metadata });
      if (tauri) expect(runtime.invoke).toHaveBeenCalledWith("get_all_settings", { projectPath: "/server/project" });
      else expect(fetch).toHaveBeenCalledWith("https://remote-server.test/api/get_all_settings", expect.objectContaining({
        method: "POST", credentials: "same-origin", body: JSON.stringify({ projectPath: "/server/project" }),
        headers: expect.objectContaining({ Authorization: "Bearer test-fixture-token" }),
      }));
    });
    it.each([null, {}, [], { scopes: null }, { serverHome: 42, scopes: { user: { state: "future", path: "/invented", readOnly: false } } }])("degrades malformed metadata to unknown: %j", async (metadata) => {
      respond({ ...legacy, metadata });
      expect(await api("get_all_settings")).toEqual({ ...legacy, metadata: { serverHome: null, scopes: {
        user: unknown, project: unknown, local: unknown, managed: unknown,
      } } });
    });
    it("validates each scope independently without inventing a managed write grant", async () => {
      respond({ ...legacy, metadata: { serverHome: "/server", scopes: {
        user: { path: null, state: "resolve_error", readOnly: false },
        project: { path: null, state: "no_project", readOnly: false },
        local: { path: "/contradiction", state: "no_project", readOnly: false },
        managed: { path: "/managed.json", state: "present", readOnly: false },
      } } });
      const result = await api<{ metadata: { scopes: Record<string, unknown> } }>("get_all_settings");
      expect(result.metadata.scopes).toEqual({
        user: { path: null, state: "resolve_error", readOnly: false },
        project: { path: null, state: "no_project", readOnly: false },
        local: unknown, managed: unknown,
      });
    });
    it("does not rewrite unrelated command responses", async () => {
      respond(legacy);
      expect(await api("get_other_settings")).toBe(legacy);
    });
  });
}
