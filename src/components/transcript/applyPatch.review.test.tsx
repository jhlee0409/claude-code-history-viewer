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

it.each([
  "@@@ -40 +42 @@",
  "@@ - 40 +42 @@",
  "@@\t-40 +42 @@",
  "@@ -040 +42 @@",
  "@@ -40,01 +42,1 @@",
  "@@ --40 +42 @@",
  "@@ -40 +-42 @@",
  "@@ -40, +42,1 @@",
  "@@ -40,1 +42, @@",
  "@@ -40 +42",
  "@@ -40 +42 extra @@",
  "@@ -40 +42 +43 @@",
  "@@ 40 42 @@",
  "@@@@",
])("unsupported apply_patch header falls back through the real routed body: %j", header => {
  const patch = `*** Begin Patch\n*** Update File: a.ts\n${header}\n-old\n+new\n*** End Patch`;
  const input = { patch };
  const body = routedBody("apply_patch", { input, expandKey: "unsupported", pathCtx: {}, t: i18n.t });
  const { container } = render(<ExpandKeyProvider value="unsupported">{body.body}</ExpandKeyProvider>);
  expect(container.querySelector("[data-diff-view]")).toBeNull();
  expect(screen.queryByRole("button", { name: i18n.t("diffView.moreActions") })).toBeNull();
  expect(JSON.parse(container.querySelector("pre")!.textContent!)).toEqual(input);
});

it.each([
  { header: "@@ -9007199254740991,3 +9007199254740991,3 @@", rows: " same\n same\n same" },
  { header: "@@ -9007199254740992 +1 @@", rows: "-old\n+new" },
  { header: "@@ -1 +9007199254740992 @@", rows: "-old\n+new" },
  { header: "@@ -1,9007199254740992 +1,1 @@", rows: "-old\n+new" },
  { header: "@@ -1,1 +1,9007199254740992 @@", rows: "-old\n+new" },
  { header: "@@ -9007199254740991,2 +1,1 @@", rows: "-old\n+new" },
  { header: "@@ -1,1 +9007199254740991,2 @@", rows: "-old\n+new" },
  // Actual rows must remain safe even when counts are omitted or understated.
  { header: "@@ -9007199254740991 +1 @@", rows: "-one\n-two\n+new" },
  { header: "@@ -1,1 +9007199254740991,1 @@", rows: "-old\n+one\n+two" },
  { header: "@@ -9007199254740990,1 +9007199254740990,1 @@", rows: " one\n two\n three" },
  { header: "@@ -1,-1 +1,1 @@", rows: "-old\n+new" },
])("unsafe apply_patch coordinates fall back through the real routed body: $header / $rows", ({ header, rows }) => {
  const input = { patch: `*** Begin Patch\n*** Update File: a.ts\n${header}\n${rows}\n*** End Patch` };
  const body = routedBody("apply_patch", { input, expandKey: "unsafe", pathCtx: {}, t: i18n.t });
  const { container } = render(<ExpandKeyProvider value="unsafe">{body.body}</ExpandKeyProvider>);
  expect(container.querySelector("[data-diff-view]")).toBeNull();
  expect(screen.queryByRole("button", { name: i18n.t("diffView.moreActions") })).toBeNull();
  expect(JSON.parse(container.querySelector("pre")!.textContent!)).toEqual(input);
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
