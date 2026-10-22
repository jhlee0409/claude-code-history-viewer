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
  });
}
