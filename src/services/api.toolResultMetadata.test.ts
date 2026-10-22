import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = readFileSync(resolve(__dirname, "../../src-tauri/tests/fixtures/tool-result-metadata.jsonl"), "utf8");
const rawMetadata: unknown[] = fixture.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>).filter(record => Object.prototype.hasOwnProperty.call(record, "toolUseResult")).map(record => record.toolUseResult);

const runtime = vi.hoisted(() => ({ tauri: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: runtime.invoke }));
vi.mock("@/utils/platform", () => ({
  isTauri: () => runtime.tauri,
  getApiBase: () => "https://fixture.test",
  getAuthToken: () => null, getCsrfToken: () => null,
  setAuthToken: vi.fn(), clearAuthToken: vi.fn(), clearAuthCookie: vi.fn(),
}));

for (const tauri of [true, false]) {
  describe(tauri ? "IPC result metadata" : "HTTP result metadata", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
    it.each([undefined, null, false, 0, "", ...rawMetadata])("preserves raw metadata without normalization: %j", async (metadata) => {
      runtime.tauri = tauri;
      const block = { type: "tool_result", tool_use_id: "call", content: "  original\n\n", is_error: false,
        ...(metadata === undefined ? {} : { toolUseResult: metadata, toolUseResultSource: { messageUuid: "r", sessionId: "s", contentIndex: 0, association: "single_result" } }),
      };
      const page = { messages: [{ uuid: "a", type: "assistant", content: [block] }], total_count: 2, has_more: false, next_offset: 2 };
      runtime.invoke.mockResolvedValue(page);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(page)) }));
      const args = { provider: "claude", sessionPath: "/fixture/s.jsonl", offset: 0, limit: 2 };
      expect(await api("load_provider_messages_paginated", args)).toEqual(page);
      if (tauri) expect(runtime.invoke).toHaveBeenCalledWith("load_provider_messages_paginated", args);
      else expect(fetch).toHaveBeenCalledWith("https://fixture.test/api/load_provider_messages_paginated", expect.objectContaining({ method: "POST", body: JSON.stringify(args) }));
      expect(block).not.toHaveProperty("exitCode");
    });
    it("keeps unassigned multi-result payload explicit rather than assigning it", async () => {
      runtime.tauri = tauri;
      const page = { messages: [{ content: [{ type: "tool_result", tool_use_id: "x", toolUseResultSource: {
        association: "unassigned", messageUuid: "r", sessionId: "s", contentIndex: 1, resultContentIndices: [1, 2], unassignedToolUseResult: { exitCode: 2 },
      } }, { type: "tool_result", tool_use_id: "y" }] }] };
      runtime.invoke.mockResolvedValue(page);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => page }));
      expect(await api("load_provider_messages_paginated")).toEqual(page);
      expect(page.messages[0]?.content[1]).not.toHaveProperty("toolUseResult");
    });
  });
}
