import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ResultSearchContext } from "./resultProvider";
import { FileEditRenderer } from "../toolResultRenderer/FileEditRenderer";
import { DiffFiltered } from "./DiffViewComparison";
import { parseApplyPatch } from "./patchDiff";
it("an explicit query retains inherited current-match metadata", () => {
  const { container } = render(<ExpandKeyProvider value="current"><ResultSearchContext.Provider value={{ searchQuery: "needle", isCurrentMatch: true, currentMatchIndex: 0 }}><FileEditRenderer toolResult={{ oldString: "old", newString: "needle" }} searchQuery="needle" /></ResultSearchContext.Provider></ExpandKeyProvider>);
  expect(container.querySelector("[data-search-highlight=current]")?.textContent).toBe("needle");
});
it("added-only view preserves a blank recorded line and its number/sign", () => {
  const { container } = render(<DiffFiltered groups={[{ startLine: 14, lines: [""] }]} kind="added" expandKey="blank-filter" />);
  expect(container.querySelectorAll("[data-diff-line=add]")).toHaveLength(1);
  expect(container.querySelector("[data-diff-new-no]")?.textContent).toBe("14");
  expect(container.querySelector("[data-diff-marker] [aria-hidden]")?.textContent).toBe("+");
});
it("apply_patch rejects any nonempty record after the end marker", () => {
  expect(parseApplyPatch("*** Begin Patch\n*** Add File: a\n+a\n*** End Patch\n*** Add File: b")).toBeNull();
});
