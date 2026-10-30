import { beforeAll, beforeEach, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import i18n from "@/i18n";
import { ToolExecutionResultRouter } from "@/components/messageRenderer/ToolExecutionResultRouter";
import { ThemeProvider } from "@/contexts/theme";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { ClaudeContentArrayRenderer } from "@/components/contentRenderer/ClaudeContentArrayRenderer";

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());
const open = (root: HTMLElement) => {
  for (let i = 0; i < 30; i++) {
    const button = root.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    if (!button) break;
    fireEvent.click(button);
  }
};
const route = (content: Record<string, unknown>, paired = false, type = "text_editor_code_execution_tool_result", name = "text_editor_code_execution") => {
  const block = { type, tool_use_id: "sdk-editor", content };
  const { container } = render(<ThemeProvider><ExpandKeyProvider value="sdk-test"><ClaudeContentArrayRenderer provider="claude" content={paired ? [{ type: "server_tool_use", id: "sdk-editor", name, input: {} }, block] : [block]} /></ExpandKeyProvider></ThemeProvider>);
  open(container);
  return container;
};
it.each([false, true])("C9 tool search reference object renders without throwing (paired=%s)", paired => {
  let root: HTMLElement | undefined;
  let error: unknown;
  try { root = route({ type: "tool_search_tool_search_result", tool_references: [{ type: "tool_reference", tool_name: "reference_needle" }] }, paired, "tool_search_tool_result", "tool_search"); } catch (caught) { error = caught; }
  expect(error).toBeUndefined();
  expect(root?.textContent).toContain("reference_needle");
});
it("C9 tool search error retains error_message and failed outcome", () => {
  const root = route({ type: "tool_search_tool_result_error", error_code: "execution_time_exceeded", error_message: "recorded search failure" }, false, "tool_search_tool_result", "tool_search");
  expect(root.textContent).toContain("recorded search failure");
  expect(root.querySelector('[data-tool-verdict="failed"]')).not.toBeNull();
});
it.each([false, true])("C10 redacted advisor is encrypted, not empty (paired=%s)", paired => {
  const root = route({ type: "advisor_redacted_result", encrypted_content: "opaque-secret" }, paired, "advisor_tool_result", "advisor");
  expect(root.textContent).toContain("Redacted");
  expect(root.textContent).not.toContain("No advice provided");
  expect(root.textContent).not.toContain("opaque-secret");
});
it("C11 WebSearch counts links, not batches/commentary, on legacy route", () => {
  const data = { query: "synthetic query", results: [{ tool_use_id: "search", content: [0,1,2].map(i => ({ title: `Link ${i}`, url: `https://example.test/${i}` })) }, "commentary"] };
  const { container } = render(<ThemeProvider><ExpandKeyProvider value="web-count"><ToolExecutionResultRouter toolResult={data} /></ExpandKeyProvider></ThemeProvider>);
  open(container);
  expect(container.textContent).toContain("3 results");
  expect(container.querySelectorAll('a[href^="https://example.test/"]')).toHaveLength(3);
});
it("C11 unified WebSearch card also counts nested links", () => {
  const content = [{ type: "tool_use", id: "web", name: "WebSearch", input: { query: "query" } }, { type: "tool_result", tool_use_id: "web", content: "commentary", toolUseResult: { query: "query", results: [{ tool_use_id: "web", content: [0,1,2].map(i => ({ title: `Link ${i}`, url: `https://example.test/${i}` })) }, "commentary"] } }];
  const { container } = render(<ThemeProvider><ExpandKeyProvider value="web-unified"><ClaudeContentArrayRenderer provider="claude" content={content} /></ExpandKeyProvider></ThemeProvider>);
  open(container);
  expect(container.textContent).toContain("3 results");
});
it("C9 malformed reference members retain raw JSON without crashing", () => {
  const root = route({ type: "tool_search_tool_search_result", tool_references: [null, { unexpected: "preserved" }] }, false, "tool_search_tool_result", "tool_search");
  expect(root.textContent).toContain("preserved");
});
it("C8 nullable and incompatible rows retain the exact record without invented diff", () => {
  for (const lines of [null, ["unrecognized row"], ["-before", "+after"]]) {
    const root = route({ type: "text_editor_code_execution_str_replace_result", lines, old_start: null, new_start: null, old_lines: 99, new_lines: null });
    expect(root.querySelector("[data-diff-view]")).toBeNull();
    expect(root.textContent).toContain("old_lines");
    expect(root.textContent).toContain("99");
  }
});
// SDK cb5fba419808e3844fa6407e59577ab7ba346b79 messages.ts:7085-7192.
it.each([false, true])("C8 actual renderer route renders view fields (paired=%s)", paired => {
  const root = route({ type: "text_editor_code_execution_view_result", content: "recorded view", file_type: "text", start_line: 8, num_lines: 1, total_lines: 20 }, paired);
  expect(root.textContent).toContain("View");
  expect(root.textContent).toContain("recorded view");
  expect(root.textContent).toContain("20");
});
it("C8 create uses its discriminator and records update false", () => {
  const root = route({ type: "text_editor_code_execution_create_result", is_file_update: false });
  expect(root.textContent).toContain("Create");
  expect(root.textContent).toContain("false");
});
it("C8 str_replace draws recorded diff and coordinates, never synthetic 1", () => {
  const root = route({ type: "text_editor_code_execution_str_replace_result", lines: ["-before", "+after"], old_start: 40, new_start: 42, old_lines: 1, new_lines: 1 });
  expect(root.querySelector("[data-diff-view]")).not.toBeNull();
  expect([...root.querySelectorAll("[data-diff-old-no]")].map(n => n.textContent)).toEqual(["40", ""]);
  expect([...root.querySelectorAll("[data-diff-new-no]")].map(n => n.textContent)).toEqual(["", "42"]);
});
it("C8 null coordinates stay unnumbered and nullable diff stays recorded", () => {
  const root = route({ type: "text_editor_code_execution_str_replace_result", lines: ["-before", "+after"], old_start: null, new_start: null, old_lines: null, new_lines: null });
  expect(root.querySelector("[data-diff-view]")).not.toBeNull();
  expect([...root.querySelectorAll("[data-diff-old-no], [data-diff-new-no]")].every(n => n.textContent === "")).toBe(true);
});
it("C8 SDK error_message is visible and outcome is failed", () => {
  const root = route({ type: "text_editor_code_execution_tool_result_error", error_code: "file_not_found", error_message: "recorded editor failure" });
  expect(root.textContent).toContain("recorded editor failure");
  expect(root.querySelector('[data-tool-verdict="failed"]')).not.toBeNull();
});
