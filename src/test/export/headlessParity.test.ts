import { describe, expect, it } from "vitest";
import cases from "../../../src-tauri/tests/fixtures/export-parity.json";
import hostileCases from "../../../src-tauri/tests/fixtures/export-hostile.json";
import { extractBlocks } from "@/services/export/contentExtractor";
import { exportToHtml } from "@/services/export/htmlExporter";
import { exportToMarkdown } from "@/services/export/markdownExporter";
import type { ClaudeMessage, ContentItem } from "@/types";

// SDK cb5fba4198: editor 7085–7192, tool search 8010–8057, advisor 360–405/449–457.
// Refusal: Claude Code 2.1.285, SHA256 51f09bd1… (docs/contracts/headless-export-parity.md).
// JSON member order is not semantic; corpus keys are sorted for a stable visible-text oracle.
describe("headless/frontend export shared oracle", () => {
  it.each(cases)("$name", ({ block, kind, text }) => {
    const content = [block] as unknown as ContentItem[];
    const message = { uuid: "parity", type: "assistant", timestamp: "2026-01-01T00:00:00Z", content } as ClaudeMessage;
    expect(extractBlocks(content)).toEqual([{ kind, text }]);
    const dom = document.createElement("div");
    dom.innerHTML = exportToHtml([message], "Parity");
    expect(dom.querySelector(".content")?.textContent).toBe(text);
    expect(dom.querySelector(".content")?.innerHTML).not.toContain("<safe>");
    expect(dom.textContent).not.toContain("opaque-do-not-display");
  });

  it.each(hostileCases)("literal escaped HTML: $name", ({ block, html }) => {
    // Inspect the serialized public export, not an expectation built by its renderer.
    const message = { uuid: "hostile", type: "assistant", timestamp: "2026-01-01T00:00:00Z", content: [block] } as unknown as ClaudeMessage;
    const output = exportToHtml([message], "Hostile export");
    for (const literal of html) expect(output).toContain(literal);
    expect(output).not.toMatch(/<script|<img|<advice|<safe>|href=["']javascript:|opaque-do-not-display|raw HTML omitted/i);
    const dom = document.createElement("div");
    dom.innerHTML = output;
    expect(dom.querySelector(".content script, .content img, .content [onerror], .content [onclick]")).toBeNull();
    expect(dom.querySelector('.content [href^="javascript:"]')).toBeNull();
  });

  it("quotes every tool-summary line as well as result lines", () => {
    const content = [{ type: "tool_use", id: "tool", name: "Run", input: { command: "first\n\nlast" } }] as ContentItem[];
    const message = { uuid: "quote-tool", type: "assistant", timestamp: "2026-01-01T00:00:00Z", content } as ClaudeMessage;
    expect(exportToMarkdown([message], "Quotes")).toContain("> **Tool:** `Run(command: first\n> \n> last)`");
  });

  it("quotes every result line, including blank lines and CRLF boundaries", () => {
    const content = [{ type: "tool_result", tool_use_id: "result", content: "first\r\n\r\nlast" }] as ContentItem[];
    const message = { uuid: "quote", type: "user", timestamp: "2026-01-01T00:00:00Z", content } as ClaudeMessage;
    expect(exportToMarkdown([message], "Quotes")).toContain("> first\n> \n> last");
  });
});
