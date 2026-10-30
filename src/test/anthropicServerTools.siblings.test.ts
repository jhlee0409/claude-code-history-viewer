import { expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { messageSearchIndex } from "@/utils/searchIndex";
import { extractBlocks } from "@/services/export/contentExtractor";
import { exportToHtml } from "@/services/export/htmlExporter";
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
it("text and HTML exports retain SDK shape facts and an honest redacted state", () => {
  const text = extractBlocks(blocks as unknown as ContentItem[]).map(b => b.text).join("\n");
  for (const value of ["str_replace", "replacementneedle", "referenceneedle", "errorneedle", "Redacted"]) expect(text).toContain(value);
  expect(text).not.toContain("secretneedle");
  const html = exportToHtml([message], "SDK fixture");
  expect(html).toContain("replacementneedle");
  expect(html).toContain("Redacted");
  expect(html).not.toContain("secretneedle");
});
