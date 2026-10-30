import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { DiffWithMenu } from "./DiffViewComparison";
import { routedBody } from "../contentRenderer/unifiedCards/toolBodies";

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());
const show = (patch: string) => render(<ExpandKeyProvider value="patch-review">{routedBody("apply_patch", { input: { patch }, expandKey: "patch-review", pathCtx: {}, t: i18n.t }).body}</ExpandKeyProvider>);
it.each(["*** Delete File: gone.ts", "*** Update File: old.ts\n*** Move to: new.ts", "*** Update File: empty.ts\n@@"])("sectionless/invalid apply_patch retains raw records without diff actions: %s", record => {
  const { container } = show(`*** Begin Patch\n${record}\n*** End Patch`);
  expect(container.textContent).toContain("*** End Patch");
  expect(screen.queryByRole("button", { name: i18n.t("diffView.moreActions") })).toBeNull();
  expect(container.querySelector("[data-diff-view]")).toBeNull();
});
it("explicit empty sections suppress the shared menu, but an empty recorded whole-file diff remains supported", () => {
  const { container, rerender } = render(<ExpandKeyProvider value="empty"><DiffWithMenu oldText="" newText="" sections={[]} expandKey="empty" /></ExpandKeyProvider>);
  expect(container.querySelector("[data-diff-with-menu]")).toBeNull();
  rerender(<ExpandKeyProvider value="empty"><DiffWithMenu oldText="" newText="" expandKey="whole-empty" /></ExpandKeyProvider>);
  expect(container.querySelector("[data-diff-with-menu]")).not.toBeNull();
});
it.each(["@@@ -40 +42 @@", "@@\t-40 +42 @@", "@@@@", "\\ No newline at end of file"])("only upstream-rejected rows use raw fallback: %j", header => {
  const patch = `*** Begin Patch\n*** Update File: a.ts\n${header}\n-old\n+new\n*** End Patch`;
  const { container } = show(patch);
  expect(container.querySelector("[data-diff-view]")).toBeNull();
  expect(JSON.parse(container.querySelector("pre")!.textContent!)).toEqual({ patch });
});
it.each(["@property", "- 40 +42 @@", "-40,1 +42,1 @@", "    def f():", "2024 config", "-9007199254740992 +42 @@"])("anchor is visible, gutters blank in every comparison mode: %j", anchor => {
  const { container } = show(`*** Begin Patch\n*** Update File: a.ts\n@@ ${anchor}\n-old\n+new\n*** End Patch`);
  const assertAnchor = () => {
    expect(container.querySelector("[data-diff-section]")?.textContent).toBe(`@@ ${anchor}`);
    expect([...container.querySelectorAll("[data-diff-old-no],[data-diff-new-no]")].map(e => e.textContent).every(n => n === "")).toBe(true);
    expect(container.querySelector("[data-diff-view]")).not.toBeNull();
  };
  assertAnchor();
  for (const mode of ["modeSideBySide", "modeWords", "modeAdvanced"] as const) {
    const trigger = screen.getByRole("button", { name: i18n.t("diffView.moreActions") });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: i18n.t(`diffView.${mode}`) }));
    assertAnchor();
  }
});
it.each([
  "*** Begin Patch\n*** Update File: a.ts\n@@ @property\n-old\n+new\n*** End Patch",
  " \n*** Begin Patch\r\n*** Environment ID: remote\r\n*** Update File: a.ts\r\n@@ - 40 +42 @@\r\n a\r\n\r\n-b  \r\n+c  \r\n*** End Patch \r\n",
  "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n@@\n+last\n*** Add File: b.ts\n+other\n*** End Patch",
])("apply_patch menu copies the exact recorded patch, not a reconstructed file: %j", async patch => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  show(patch);
  const trigger = screen.getAllByRole("button", { name: i18n.t("diffView.moreActions") })[0]!;
  trigger.focus(); fireEvent.keyDown(trigger, { key: "Enter" });
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("common.copy") })));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(patch);
});
