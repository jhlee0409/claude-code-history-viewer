import { render } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { ResultSearchContext } from "./resultProvider";
import { DiffComparisonBody, type ComparisonMode } from "./DiffViewComparison";

beforeAll(async () => { await i18n.changeLanguage("en"); });
it.each(["", "a.ts"])("split context has one current owner and retains mirror search marks (syntax %j)", filePath => {
  const { container } = render(<ExpandKeyProvider value="owner"><DiffComparisonBody mode="sideBySide" sections={[{ oldText: "const needle = 1;\nold", newText: "const needle = 1;\nnew" }]} filePath={filePath} expandKey="owner" highlight={{ searchQuery: "needle", isCurrentMatch: true }} /></ExpandKeyProvider>);
  expect(container.querySelectorAll("mark")).toHaveLength(2);
  expect(container.querySelectorAll("[data-search-highlight=current]")).toHaveLength(1);
  expect(container.querySelectorAll("[aria-current=true]")).toHaveLength(1);
  expect(container.querySelector("[data-search-highlight=current]")?.closest("td")).toBe(container.querySelector("[data-diff-code]"));
});
it.each(["unified", "words", "sideBySide", "advanced"] as ComparisonMode[])("%s owns the indexed occurrence across physical lines rather than one per line", mode => {
  const { container } = render(<ExpandKeyProvider value="ordinal"><DiffComparisonBody mode={mode} sections={[{ oldText: "needle context\nold", newText: "needle context\nneedle added" }]} expandKey="ordinal" highlight={{ searchQuery: "needle", isCurrentMatch: true, currentMatchIndex: 1 }} /></ExpandKeyProvider>);
  expect(container.querySelectorAll("[data-search-highlight=current]")).toHaveLength(1);
  expect(container.querySelector("[data-search-highlight=current]")?.closest("[data-diff-code]")?.textContent).toBe("needle added");
});
it.each(["unified", "words", "sideBySide", "advanced"] as ComparisonMode[])("%s shares the current ordinal across sections", mode => {
  const { container } = render(<ExpandKeyProvider value="sections"><DiffComparisonBody mode={mode} sections={[{ oldText: "", newText: "needle first" }, { oldText: "", newText: "needle second" }]} expandKey="sections" highlight={{ searchQuery: "needle", isCurrentMatch: true, currentMatchIndex: 1 }} /></ExpandKeyProvider>);
  expect(container.querySelectorAll("[data-search-highlight=current]")).toHaveLength(1);
  expect(container.querySelector("[data-search-highlight=current]")?.closest("[data-diff-code]")?.textContent).toBe("needle second");
});
it("mode switches preserve a single current occurrence through syntax/word boundaries and inherited metadata", () => {
  const view = (mode: ComparisonMode, currentMatchIndex: number) => <ExpandKeyProvider value="switch"><ResultSearchContext.Provider value={{ searchQuery: "needle", isCurrentMatch: true, currentMatchIndex }}><DiffComparisonBody mode={mode} sections={[{ oldText: "const needle = 'needle';\nold", newText: "const needle = 'needle';\nnew" }]} filePath="a.ts" expandKey="switch" /></ResultSearchContext.Provider></ExpandKeyProvider>;
  const { container, rerender } = render(view("unified", 1));
  for (const mode of ["unified", "sideBySide", "words", "advanced", "sideBySide", "unified"] as ComparisonMode[]) {
    rerender(view(mode, 1));
    expect(container.querySelectorAll("[data-search-highlight=current]")).toHaveLength(1);
    expect(container.querySelectorAll("[aria-current=true]")).toHaveLength(1);
    expect(container.querySelector("[data-search-highlight=current]")?.textContent).toBe("needle");
  }
  rerender(view("sideBySide", 0));
  expect(container.querySelectorAll("[data-search-highlight=current]")).toHaveLength(1);
});
