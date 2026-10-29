import { render } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { DiffComparisonBody } from "./DiffViewComparison";
beforeAll(async () => { await i18n.changeLanguage("en"); });
it("word comparison uses colour and underline, keeps all source text and +/- signs", () => {
  const { container } = render(<ExpandKeyProvider value="word"><DiffComparisonBody mode={"words" as "unified"} sections={[{ oldText: "one red fox\n", newText: "one blue fox\n" }]} expandKey="word" /></ExpandKeyProvider>);
  const words = [...container.querySelectorAll("[data-diff-word]")];
  expect(words.map(w => w.textContent)).toEqual(["red", "blue"]);
  expect(words.every(w => w.classList.contains("underline"))).toBe(true);
  expect(words[0].className).toContain("bg-diff-word-del-bg");
  expect(words[1].className).toContain("decoration-diff-word-add-mark");
  expect([...container.querySelectorAll("[data-diff-code]")].map(w => w.textContent)).toEqual(["one red fox", "one blue fox"]);
  expect([...container.querySelectorAll("[data-diff-marker] [aria-hidden]")].map(w => w.textContent)).toEqual(["−", "+"]);
});
