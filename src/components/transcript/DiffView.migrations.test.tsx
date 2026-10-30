import { render, fireEvent } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ResultRowContext } from "./resultRowContext";
import { FileEditRenderer } from "../toolResultRenderer/FileEditRenderer";
import { StructuredPatchRenderer } from "../toolResultRenderer/StructuredPatchRenderer";
import { TextEditorCodeExecutionToolResultRenderer } from "../contentRenderer/TextEditorCodeExecutionToolResultRenderer";
import { routedBody } from "../contentRenderer/unifiedCards/toolBodies";
beforeAll(async () => { await i18n.changeLanguage("en"); });
const wrap = (body: React.ReactNode) => render(<ExpandKeyProvider value="migrations">{body}</ExpandKeyProvider>);
it("structured patches retain hunk start numbers and every hunk in DiffView", () => {
  const { container } = wrap(<StructuredPatchRenderer toolResult={{ filePath: "a.ts", structuredPatch: [{ oldStart: 8, newStart: 8, lines: ["-old", "+new"] }, { oldStart: 40, newStart: 41, lines: ["-last", "+LAST"] }] }} />);
  const toggle = container.querySelector<HTMLButtonElement>("[data-tool-row] button[aria-expanded]");
  if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  expect(container.querySelectorAll("[data-diff-view]").length).toBeGreaterThan(0);
  expect([...container.querySelectorAll("[data-diff-old-no]")].map(e => e.textContent)).toEqual(["8", "", "40", ""]);
});
it("text editor does not invent a diff from fields absent in the SDK", () => {
  const { container } = wrap(<ResultRowContext.Provider value={{ paired: true }}><TextEditorCodeExecutionToolResultRenderer toolUseId="unlabelled" content={{ type: "text_editor_code_execution_result", old_content: "before", new_content: "after" }} /></ResultRowContext.Provider>);
  expect(container.querySelector("[data-diff-view]")).toBeNull();
});
it("removing the invented text-editor diff leaves the existing content disclosure intact", () => {
  const { container } = wrap(<ResultRowContext.Provider value={{ paired: true }}><TextEditorCodeExecutionToolResultRenderer toolUseId="editor" content={{ type: "text_editor_code_execution_result", operation: "edit", path: "a.ts", old_content: "removed\n", new_content: "", content: "recorded supplement" }} /></ResultRowContext.Provider>);
  expect(container.querySelector("[data-diff-view]")).toBeNull();
  fireEvent.click(container.querySelector<HTMLButtonElement>("button[aria-expanded]")!);
  expect(container.textContent).toContain("recorded supplement");
});
it("apply_patch routes multi-file edits to DiffView while retaining the raw patch and unknown fields", () => {
  const patch = "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** Add File: b.ts\n+second\n*** End Patch";
  const body = routedBody("apply_patch", { input: { patch, extra: "recorded extra" }, expandKey: "patch", pathCtx: {}, t: i18n.t });
  const { container } = wrap(body.body);
  expect(container.querySelectorAll("[data-diff-view]")).toHaveLength(2);
  expect(container.textContent).toContain("recorded extra");
  expect(container.textContent).toContain("*** End Patch");
});
it("diff search marks hits even across word emphasis and reveals capped/context content", () => {
  const old = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
  const { container } = wrap(<FileEditRenderer toolResult={{ oldString: old, newString: old.replace("line 70", "line seventy") }} searchQuery="line 2" />);
  expect(container.querySelector("mark")?.textContent).toBe("line 2");
});
