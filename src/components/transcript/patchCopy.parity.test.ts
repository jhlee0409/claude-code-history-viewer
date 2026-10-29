import { expect, it } from "vitest";
import { structuredSections } from "./patchDiff";
it("structured patch after-copy preserves every legacy reconstructed row, including newline metadata", () => {
  const sections = structuredSections([{ lines: [" old context", "-old", "+new", "\\ No newline at end of file"] }, { lines: ["+last"] }]);
  expect(sections.map(s => s.copyText ?? s.newText).join("\n")).toBe("old context\nnew\n\\ No newline at end of file\nlast");
});
