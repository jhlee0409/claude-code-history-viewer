/**
 * The opened detail never loses a result's recorded content (plan §4.3:
 * image / document / unknown fallbacks stay reachable; PR #728 review F1).
 *
 * Stream fields (stdout / stderr) are extra evidence, not a replacement for
 * the content: with stream text the OutputBlock zones show it and every
 * non-text content block still goes through the existing result renderers
 * below; with empty streams the content itself is shown (text in an
 * OutputBlock, the rest through the renderers). "No output" only when
 * nothing at all is recorded.
 *
 * Each fallback case first renders the same result through the existing
 * `ResultBlock` as a control, so the marker is something those renderers
 * really show.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/contexts/theme", () => ({ useTheme: () => ({ isDarkMode: false, theme: "light" }) }));
import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { ResultBlock } from "@/components/contentRenderer/unifiedCards/ResultBlock";
import { UnifiedToolExecutionRenderer } from "@/components/contentRenderer/UnifiedToolExecutionRenderer";
import { ToolResultOutputs } from "./ToolResultOutputs";
import type { ToolFamily, ToolResultLike } from "./toolOutcome";

const own = (toolUseResult: unknown) => ({
  toolUseResult,
  toolUseResultSource: { messageUuid: "m", sessionId: "s", contentIndex: 0, association: "single_result" },
});
const result = (content: unknown, extra: Record<string, unknown> = {}): ToolResultLike => ({
  type: "tool_result",
  tool_use_id: "toolu_r",
  content,
  ...extra,
});
const wrap = (ui: ReactNode) => render(<ExpandKeyProvider value="msg-outputs">{ui}</ExpandKeyProvider>);
const outputs = (results: ToolResultLike[], family: ToolFamily = "read-search") =>
  wrap(<ToolResultOutputs results={results} family={family} expandKey="outputs" />);
/** The text the existing renderers show for these results (the control). */
const baseText = (results: ToolResultLike[]) => {
  const view = wrap(<ResultBlock results={results} />);
  const text = view.container.textContent ?? "";
  view.unmount();
  return text;
};

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const NON_TEXT_BLOCKS: Array<[string, Record<string, unknown>, string]> = [
  // The existing tool-result renderers show an image block as its recorded JSON.
  ["image", { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }, PNG],
  ["document", { type: "document", title: "PRESERVE_ME_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "DOCUMENT_BODY" } }, "PRESERVE_ME_DOCUMENT"],
  ["search_result", { type: "search_result", title: "PRESERVE_ME_SEARCH", source: "https://example.com/r", content: [{ type: "text", text: "SEARCH_BODY" }] }, "PRESERVE_ME_SEARCH"],
  ["unknown type", { type: "novel-type", marker: "PRESERVE_ME_UNKNOWN" }, "PRESERVE_ME_UNKNOWN"],
];
const shows = (container: HTMLElement, marker: string) => (container.textContent ?? "").includes(marker);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => useExpandRegistry.getState().clearAll());

describe("ToolResultOutputs: empty streams never hide the content", () => {
  it.each(NON_TEXT_BLOCKS)("%s block beside {stdout:'', stderr:''} stays visible", (_kind, block, marker) => {
    const r = result([block], own({ stdout: "", stderr: "" }));
    const control = wrap(<ResultBlock results={[r]} />);
    expect(shows(control.container, marker), "control: the existing renderer shows it").toBe(true);
    control.unmount();

    const view = outputs([r]);
    expect(shows(view.container, marker)).toBe(true);
    expect(view.container.textContent).not.toContain("No output");
  });

  it("the review's Read: a document and an unknown block, both kept", () => {
    const r = result(
      [
        { type: "document", title: "PRESERVE_ME_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "DOCUMENT_BODY" } },
        { type: "novel-type", marker: "PRESERVE_ME_UNKNOWN" },
      ],
      own({ stdout: "", stderr: "" }),
    );
    expect(baseText([r])).toContain("PRESERVE_ME_UNKNOWN");
    const text = outputs([r]).container.textContent ?? "";
    expect(text).toContain("PRESERVE_ME_DOCUMENT");
    expect(text).toContain("PRESERVE_ME_UNKNOWN");
    expect(text).not.toContain("No output");
  });

  it("text blocks beside empty streams are shown raw in an OutputBlock", () => {
    const r = result([{ type: "text", text: "TEXT_ONE\n# not a heading" }, { type: "text", text: "TEXT_TWO" }], own({ stdout: "", stderr: "" }));
    const view = outputs([r]);
    const block = view.container.querySelector("[data-output]");
    expect(block, "an OutputBlock").not.toBeNull();
    expect(block?.textContent).toContain("TEXT_ONE\n# not a heading");
    expect(block?.textContent).toContain("TEXT_TWO");
    expect(view.container.querySelector("h1")).toBeNull();
    expect(view.container.textContent).not.toContain("No output");
  });

  it("text and a non-text block beside empty streams: both kept", () => {
    const r = result([{ type: "text", text: "TEXT_PART" }, { type: "novel-type", marker: "PRESERVE_ME_UNKNOWN" }], own({ stdout: "", stderr: "" }));
    const text = outputs([r]).container.textContent ?? "";
    expect(text).toContain("TEXT_PART");
    expect(text).toContain("PRESERVE_ME_UNKNOWN");
  });

  it("a string content beside empty streams is shown with the recorded exit code", () => {
    const view = outputs([result("(no output)", own({ stdout: "", stderr: "", exitCode: 0 }))], "process");
    expect(view.container.querySelector("[data-output]")?.textContent).toContain("(no output)");
    expect(view.container.textContent).toMatch(/exit code 0/i);
    expect(view.container.textContent).not.toContain("No output");
  });

  it("an object content that is not the stream record stays visible beside empty streams", () => {
    const r = result({ type: "novel-object", marker: "PRESERVE_ME_OBJECT" }, own({ stdout: "", stderr: "" }));
    expect(baseText([r])).toContain("PRESERVE_ME_OBJECT");
    expect(outputs([r]).container.textContent).toContain("PRESERVE_ME_OBJECT");
  });

  it("'No output' only when nothing is recorded anywhere", () => {
    for (const content of ["", []]) {
      const view = outputs([result(content, own({ stdout: "", stderr: "" }))]);
      expect(view.container.textContent).toContain("No output");
      view.unmount();
    }
  });
});

describe("ToolResultOutputs: stream text is added, the content's non-text blocks stay", () => {
  it.each(NON_TEXT_BLOCKS)("stdout + stderr zones and the %s block below them", (_kind, block, marker) => {
    const r = result([{ type: "text", text: "OUT\nERR" }, block], own({ stdout: "OUT", stderr: "ERR", exitCode: 1 }));
    const view = outputs([r], "process");
    const output = view.container.querySelector("[data-output]") as HTMLElement;
    expect(output, "an OutputBlock").not.toBeNull();
    expect(output.textContent).toContain("OUT");
    expect(within(output).getByText("ERR").closest("[data-stderr]")).not.toBeNull();
    expect(output.textContent).toMatch(/exit code 1/i);
    expect(shows(view.container, marker)).toBe(true);
  });

  it("the content's text is not repeated beside stdout (stdout is that text)", () => {
    const r = result([{ type: "text", text: "SAME_TEXT" }], own({ stdout: "SAME_TEXT", stderr: "" }));
    const text = outputs([r], "process").container.textContent ?? "";
    expect(text.split("SAME_TEXT").length - 1).toBe(1);
  });

  it("an object content that is not the stream record stays visible beside stdout", () => {
    const r = result({ type: "novel-object", marker: "PRESERVE_ME_OBJECT" }, own({ stdout: "OUT", stderr: "" }));
    const text = outputs([r], "process").container.textContent ?? "";
    expect(text).toContain("OUT");
    expect(text).toContain("PRESERVE_ME_OBJECT");
  });

  it("a content object that is the stream record is shown once, as zones", () => {
    const r = result({ stdout: "ONLY_ONCE", stderr: "", exit_code: 0 });
    const view = outputs([r], "process");
    expect((view.container.textContent ?? "").split("ONLY_ONCE").length - 1).toBe(1);
    expect(view.container.querySelector("[data-output]")?.textContent).toMatch(/exit code 0/i);
  });
});

describe("adopted cards keep the content (real dispatch)", () => {
  const card = (name: string, input: Record<string, unknown>, r: ToolResultLike) => {
    const view = wrap(<UnifiedToolExecutionRenderer toolUse={{ type: "tool_use", id: `toolu_${name}`, name, input }} toolResults={[r]} />);
    fireEvent.click(view.container.querySelector("[data-tool-row] button[aria-expanded='false']") as HTMLElement);
    return view.container.textContent ?? "";
  };
  const reviewRead = () =>
    result(
      [
        { type: "document", title: "PRESERVE_ME_DOCUMENT", source: { type: "text", media_type: "text/plain", data: "DOCUMENT_BODY" } },
        { type: "novel-type", marker: "PRESERVE_ME_UNKNOWN" },
      ],
      own({ stdout: "", stderr: "" }),
    );

  it.each([
    ["Read", { file_path: "probe.dat" }],
    ["Grep", { pattern: "x" }],
    ["Glob", { pattern: "*.dat" }],
    ["Write", { file_path: "probe.dat", content: "x" }],
    ["Bash", { command: "cat probe.dat" }],
  ] as const)("%s: opened, the document and the unknown block are there", (name, input) => {
    const text = card(name, input, reviewRead());
    expect(text).toContain("PRESERVE_ME_DOCUMENT");
    expect(text).toContain("PRESERVE_ME_UNKNOWN");
    expect(text).not.toContain("No output");
  });
});
