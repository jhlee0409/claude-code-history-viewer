import { beforeEach, describe, expect, it, vi } from "vitest";
import { readingDocumentUrl, prepareReadingDocument } from "@/services/reading";

const { api, convertFileSrc, platform } = vi.hoisted(() => ({
  api: vi.fn(), convertFileSrc: vi.fn((id: string, scheme: string) => `${scheme}://localhost/${id}`),
  platform: { desktop: false, base: "https://viewer.example/prefix" },
}));
vi.mock("@/services/api", () => ({ api }));
vi.mock("@/utils/platform", () => ({ isTauri: () => platform.desktop, getApiBase: () => platform.base }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc }));
const document = { document_id: "document-1", capability: "capability-1", bridge_nonce: "bridge-1", renderer_version: "1.7.0" };
beforeEach(() => { vi.clearAllMocks(); platform.desktop = false; });

describe("reading document transport", () => {
  it("preserves WebUI base paths without forwarding a global token", async () => {
    expect(await readingDocumentUrl(document)).toBe("https://viewer.example/prefix/api/reading_documents/document-1?capability=capability-1");
  });
  it("uses the dedicated scheme on desktop", async () => {
    platform.desktop = true;
    expect(await readingDocumentUrl(document)).toBe("reading://localhost/document-1?capability=capability-1");
    expect(convertFileSrc).toHaveBeenCalledWith("document-1", "reading");
  });
  it("rejects malformed preparation responses", async () => {
    api.mockResolvedValueOnce({ ...document, capability: null });
    await expect(prepareReadingDocument("/session.jsonl", false)).rejects.toThrow("Invalid reading document response");
  });
});
