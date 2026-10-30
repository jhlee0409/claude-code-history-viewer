import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { DiffWithMenu } from "./DiffViewComparison";
import { routedBody } from "../contentRenderer/unifiedCards/toolBodies";

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());

it.each(["*** Delete File: gone.ts", "*** Update File: old.ts\n*** Move to: new.ts", "*** Update File: empty.ts\n@@"])("sectionless apply_patch preserves paths/raw records but has no diff actions: %s", record => {
  const body = routedBody("apply_patch", { input: { patch: `*** Begin Patch\n${record}\n*** End Patch` }, expandKey: "empty-patch", pathCtx: {}, t: i18n.t });
  const { container } = render(<ExpandKeyProvider value="empty-patch">{body.body}</ExpandKeyProvider>);
  expect(container.textContent).toContain(record.split(": ")[1]!.split("\n")[0]!);
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

const patchBody = (hunks: string) => routedBody("apply_patch", {
  input: { patch: `*** Begin Patch\n*** Update File: a.ts\n${hunks}\n*** End Patch` },
  expandKey: "patch-review", pathCtx: {}, t: i18n.t,
}).body;

it.each([
  { name: "deletion-only then addition", hunks: "@@\n-old\n@@\n+last", expected: "last" },
  { name: "addition then deletion-only", hunks: "@@\n+first\n@@\n-old", expected: "first" },
  { name: "only deletions", hunks: "@@\n-old\n@@\n-last", expected: "" },
  { name: "recorded blank context", hunks: "@@\n \n@@\n+last", expected: "\nlast" },
  { name: "recorded blank addition", hunks: "@@\n+\n@@\n+last", expected: "\nlast" },
  { name: "multiple nonempty hunks", hunks: "@@\n-old\n+new\n@@\n+last", expected: "new\nlast" },
  { name: "newline metadata", hunks: "@@\n-old\n+new\n\\ No newline at end of file\n@@\n+last", expected: "new\n\\ No newline at end of file\nlast" },
])("apply_patch real menu preserves recorded after rows: $name", async ({ hunks, expected }) => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<ExpandKeyProvider value="patch-review">{patchBody(hunks)}</ExpandKeyProvider>);
  const trigger = screen.getByRole("button", { name: i18n.t("diffView.moreActions") });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: i18n.t("diffViewer.copyAfterCode") })));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(expected);
});
