import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { StructuredPatchRenderer } from "../toolResultRenderer/StructuredPatchRenderer";
beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());
it.each([
  { name: "newline metadata", patches: [{ lines: [" old context", "-old", "+new", "\\ No newline at end of file"] }, { lines: ["+last"] }], expected: "old context\nnew\n\\ No newline at end of file\nlast" },
  { name: "a deletion-only hunk before an addition", patches: [{ lines: ["-old"] }, { lines: ["+last"] }], expected: "last" },
  { name: "an actual blank context line", patches: [{ lines: [" "] }, { lines: ["+last"] }], expected: "\nlast" },
])("structured-patch copy payload parity: $name", async ({ patches, expected }) => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { container } = render(createElement(ExpandKeyProvider, { value: "patch-copy", children: createElement(StructuredPatchRenderer, { toolResult: { filePath: "a.ts", structuredPatch: patches } }) }));
  fireEvent.click(container.querySelector<HTMLElement>("[data-tool-row] button[aria-expanded]")!);
  const trigger = screen.getByRole("button", { name: i18n.t("diffView.moreActions") });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("diffViewer.copyAfterCode") })));
  expect(writeText).toHaveBeenCalledWith(expected);
});
