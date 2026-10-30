import { render } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { DiffView } from "./DiffView";
import { DiffComparisonBody } from "./DiffViewComparison";
beforeAll(async () => { await i18n.changeLanguage("en"); });
it("a current search hit spanning word boundaries has one current scroll target", () => {
  const { container } = render(<ExpandKeyProvider value="search-word"><DiffComparisonBody mode="words" sections={[{ oldText: "one red fox", newText: "one blue fox" }]} expandKey="search" highlight={{ searchQuery: "one blue", isCurrentMatch: true }} /></ExpandKeyProvider>);
  expect([...container.querySelectorAll("mark")].map(e => e.textContent).join("")).toBe("one blue");
  expect(container.querySelectorAll("[data-search-highlight=current]")).toHaveLength(1);
});
it("recorded patch rows receive word emphasis without changing their order or numbers", () => {
  const { container } = render(<ExpandKeyProvider value="patch-word"><DiffView sections={[{ oldText: "one red fox", newText: "one blue fox", lines: [{ kind: "del", oldNo: 9, newNo: null, text: "one red fox" }, { kind: "add", oldNo: null, newNo: 12, text: "one blue fox" }] }]} expandKey="patch-word" method="words" /></ExpandKeyProvider>);
  expect([...container.querySelectorAll("[data-diff-word]")].map(e => e.textContent)).toEqual(["red", "blue"]);
  expect(container.querySelector("[data-diff-old-no]")?.textContent).toBe("9");
});
it("word comparison uses colour and underline, keeps all source text and +/- signs", () => {
  const { container } = render(<ExpandKeyProvider value="word"><DiffComparisonBody mode="words" sections={[{ oldText: "one red fox\n", newText: "one blue fox\n" }]} expandKey="word" /></ExpandKeyProvider>);
  const words = [...container.querySelectorAll("[data-diff-word]")];
  expect(words.map(w => w.textContent)).toEqual(["red", "blue"]);
  expect(words.every(w => w.classList.contains("underline"))).toBe(true);
  expect(words[0].className).toContain("bg-diff-word-del-bg");
  expect(words[1].className).toContain("decoration-diff-word-add-mark");
  expect([...container.querySelectorAll("[data-diff-code]")].map(w => w.textContent)).toEqual(["one red fox", "one blue fox"]);
  expect([...container.querySelectorAll("[data-diff-marker] [aria-hidden]")].map(w => w.textContent)).toEqual(["−", "+"]);
});
