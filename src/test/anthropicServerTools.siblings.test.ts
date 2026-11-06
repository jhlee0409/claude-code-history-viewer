import { expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { messageSearchIndex } from "@/utils/searchIndex";
import { extractBlocks } from "@/services/export/contentExtractor";
import { exportToHtml } from "@/services/export/htmlExporter";
import { exportToMarkdown } from "@/services/export/markdownExporter";
import { serverResultTexts } from "@/components/contentRenderer/serverResultText";
import type { ClaudeMessage, ContentItem } from "@/types";
const blocks = [
  { type: "text_editor_code_execution_tool_result", tool_use_id: "edit", content: { type: "text_editor_code_execution_str_replace_result", lines: ["-previousneedle", "+replacementneedle"], old_start: 8, new_start: 9, old_lines: 1, new_lines: 1 } },
  { type: "tool_search_tool_result", tool_use_id: "search", content: { type: "tool_search_tool_search_result", tool_references: [{ type: "tool_reference", tool_name: "referenceneedle" }] } },
  { type: "advisor_tool_result", tool_use_id: "advisor", content: { type: "advisor_redacted_result", encrypted_content: "secretneedle" } },
  { type: "text_editor_code_execution_tool_result", tool_use_id: "error", content: { type: "text_editor_code_execution_tool_result_error", error_code: "file_not_found", error_message: "errorneedle" } },
];
const message = { uuid: "sdk-message", type: "assistant", timestamp: "2026-01-01T00:00:00Z", content: blocks } as unknown as ClaudeMessage;
it("server search extraction reads SDK lines/references/errors, never encrypted data", () => {
  expect(serverResultTexts(blocks).join(" ")).toContain("referenceneedle");
  expect(serverResultTexts(blocks).join(" ")).toContain("replacementneedle");
  expect(serverResultTexts(blocks).join(" ")).toContain("errorneedle");
  expect(serverResultTexts(blocks).join(" ")).not.toContain("secretneedle");
});
it("main search index counts the new SDK fields", async () => {
  messageSearchIndex.build([message]);
  await waitFor(() => expect(messageSearchIndex.isReady()).toBe(true));
  for (const query of ["referenceneedle", "replacementneedle", "errorneedle"]) expect(messageSearchIndex.search(query, "content")).toHaveLength(1);
  expect(messageSearchIndex.search("secretneedle", "content")).toHaveLength(0);
});
it("search worker protocol indexes SDK plaintext but never advisor ciphertext", async () => {
  const worker = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  try {
    await import("@/utils/searchWorker");
    worker.onmessage!({ data: { type: "build", messages: [message] } });
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "build-complete", count: 1 });
    for (const [id, query] of ["replacementneedle", "referenceneedle", "errorneedle", "secretneedle"].entries()) {
      worker.onmessage!({ data: { type: "search", id, query, filterType: "content" } });
      expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "search-result", id, results: query === "secretneedle" ? [] : [{ messageUuid: "sdk-message", messageIndex: 0, matchIndex: 0, matchCount: 1 }] });
    }
  } finally { vi.unstubAllGlobals(); }
});
it("plain SDK advisor exports its text instead of serialized metadata", () => {
  const content = [{ type: "advisor_tool_result", tool_use_id: "plain", content: { type: "advisor_result", text: "Use <safe> advice", stop_reason: "end_turn" } }] as unknown as ContentItem[];
  expect(extractBlocks(content)).toEqual([{ kind: "result", text: "Use <safe> advice" }]);
  const html = exportToHtml([{ ...message, content }], "Advisor");
  expect(html).toContain("Use &lt;safe&gt; advice");
  expect(html).not.toContain("stop_reason");
});
it.each([false, true])("advisor truncation survives text, HTML and Markdown export (redacted=%s)", redacted => {
  const advice = "Partial <safe> advice";
  const inner = redacted ? { type: "advisor_redacted_result", encrypted_content: "opaque-secret", stop_reason: "max_tokens" } : { type: "advisor_result", text: advice, stop_reason: "max_tokens" };
  const content = [{ type: "advisor_tool_result", tool_use_id: "truncated", content: inner }] as unknown as ContentItem[];
  const notice = "[Advice truncated: output token limit reached.]";
  const text = extractBlocks(content).map(b => b.text).join("\n");
  const html = exportToHtml([{ ...message, content }], "Advisor");
  const markdown = exportToMarkdown([{ ...message, content }], "Advisor");
  for (const output of [text, html, markdown]) {
    expect(output).toContain(notice);
    expect(output).not.toContain("opaque-secret");
    expect(output).toContain(redacted ? "Redacted advice" : "Partial");
  }
  if (!redacted) {
    expect(text).toContain(advice);
    expect(markdown).toContain(advice);
    expect(html).toContain("Partial &lt;safe&gt; advice");
    expect(html).not.toContain("<safe>");
  }
});
it.each(["end_turn", "stop_sequence", "tool_use", "pause_turn", "compaction", "refusal", "model_context_window_exceeded", null, undefined, "MAX_TOKENS", "unknown"])("advisor export leaves other stop reasons unchanged: %s", stop_reason => {
  for (const inner of [
    { type: "advisor_result", text: "Complete advice", stop_reason },
    { type: "advisor_redacted_result", encrypted_content: "opaque-secret", stop_reason },
    { type: "advisor_tool_result_error", error_code: "invalid_tool_input", stop_reason: "max_tokens" },
  ]) {
    const content = [{ type: "advisor_tool_result", tool_use_id: "control", content: inner }] as unknown as ContentItem[];
    for (const output of [extractBlocks(content)[0]!.text, exportToHtml([{ ...message, content }], "Advisor"), exportToMarkdown([{ ...message, content }], "Advisor")]) {
      expect(output).not.toContain("Advice truncated:");
      expect(output).not.toContain("opaque-secret");
    }
  }
});
it("text and HTML exports retain SDK shape facts and an honest redacted state", () => {
  const text = extractBlocks(blocks as unknown as ContentItem[]).map(b => b.text).join("\n");
  for (const value of ["str_replace", "replacementneedle", "referenceneedle", "errorneedle", "Redacted"]) expect(text).toContain(value);
  expect(text).not.toContain("secretneedle");
  const html = exportToHtml([message], "SDK fixture");
  expect(html).toContain("replacementneedle");
  expect(html).toContain("Redacted");
  expect(html).not.toContain("secretneedle");
});
