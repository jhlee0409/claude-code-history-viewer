import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ThemeProvider } from "@/contexts/theme/ThemeProvider";
import { StructuredPatchRenderer } from "../toolResultRenderer/StructuredPatchRenderer";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { routedBody } from "../contentRenderer/unifiedCards/toolBodies";

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());
const show = (patch: string) => render(<ExpandKeyProvider value="fix4">{routedBody("apply_patch", { input: { patch }, expandKey: "fix4", pathCtx: {}, t: i18n.t }).body}</ExpandKeyProvider>);

// Codex 788b9d7b: apply_patch.lark:7,13; streaming_parser.rs:107-135,253-260.
it.each([{ structuredPatch: [] }, { structuredPatch: [{ unsupported: true }] }])("does not claim zero changed areas when no supported hunks are recorded: %j", ({ structuredPatch }) => {
  const { container } = render(<ThemeProvider><ExpandKeyProvider value="areas"><StructuredPatchRenderer toolResult={{ type: "create", filePath: "a.ts", content: "recorded file", structuredPatch }} /></ExpandKeyProvider></ThemeProvider>);
  const toggle = container.querySelector<HTMLButtonElement>("[data-tool-row] button[aria-expanded]");
  if (toggle?.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  expect(container.textContent).not.toContain(i18n.t("structuredPatch.areasChanged", { count: 0 }));
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')) fireEvent.click(button);
  expect(container.textContent).toContain("recorded file");
});
it("shows Delete File as an explicit operation without inventing deleted content", () => {
  const { container } = show("*** Begin Patch\n*** Delete File: gone.ts\n*** End Patch");
  expect(screen.getByText("Deleted")).not.toBeNull();
  expect(container.querySelector("[data-diff-view]")).toBeNull();
});
it("copies only the selected file's recorded section, and keeps whole-patch copy explicit", async () => {
  const first = "*** Update File: old.ts\r\n*** Move to: new.ts\r\n@@ anchor\r\n-old  \r\n+new  ";
  const second = "*** Add File: second.ts\r\n+second";
  const patch = `*** Begin Patch\r\n${first}\r\n${second}\r\n*** End Patch`;
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  show(patch);
  const triggers = screen.getAllByRole("button", { name: i18n.t("diffView.moreActions") });
  for (const [index, expected] of [first, second].entries()) {
    triggers[index]!.focus(); fireEvent.keyDown(triggers[index]!, { key: "Enter" });
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("common.copy") })));
    expect(writeText).toHaveBeenLastCalledWith(expected);
  }
  triggers[0]!.focus(); fireEvent.keyDown(triggers[0]!, { key: "Enter" });
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("diffView.copyPatch") })));
  expect(writeText).toHaveBeenLastCalledWith(patch);
});
it("labels a complete raw patch as recorded input rather than other fields", () => {
  const patch = "*** Begin Patch\n*** Add File: a\n+x\n*** End Patch";
  const { container } = show(patch);
  expect(container.textContent).not.toContain(i18n.t("toolRow.otherRecordedFields"));
  expect(container.textContent).toContain(i18n.t("diffView.recordedInput"));
  expect(JSON.parse(container.querySelector("pre")!.textContent!)).toEqual({ patch });
});
it("shows the move source and destination together above its recorded hunks", () => {
  const { container } = show("*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n@@\n-old\n+new\n*** End Patch");
  expect(container.querySelector("[data-patch-operation]")?.textContent).toContain("old.ts → new.ts");
  expect(container.querySelector("[data-diff-view]")).not.toBeNull();
});
