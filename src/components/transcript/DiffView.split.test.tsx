import { render as baseRender, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeContext } from "@/contexts/theme/context";
const render = (children: ReactNode) => baseRender(<ThemeContext.Provider value={{ theme: "dark", isDarkMode: true, setTheme: async () => {}, initializeTheme: async () => {} }}>{children}</ThemeContext.Provider>);
import { beforeAll, beforeEach, expect, it } from "vitest";
import i18n from "@/i18n";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { useExpandRegistry } from "@/store/expandRegistryStore";
import { DiffComparisonBody } from "./DiffViewComparison";

beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => useExpandRegistry.getState().clearAll());
it("split retains syntax highlighting for a recorded TypeScript file", () => {
  const { container } = render(<ExpandKeyProvider value="syntax"><DiffComparisonBody mode="sideBySide" filePath="src/a.ts" sections={[{ oldText: "const a = 1;", newText: "const a = 2;" }]} expandKey="syntax" /></ExpandKeyProvider>);
  expect(container.querySelector(".text-code-keyword")?.textContent).toBe("const");
  expect(container.querySelectorAll("[data-diff-word]").length).toBeGreaterThan(0);
});
it("split pairs each replacement run in order, pads unequal sides, and keeps blank context signs", () => {
  const { container } = render(<ExpandKeyProvider value="split"><DiffComparisonBody mode="sideBySide" sections={[{ oldText: "same\na\nb\nend\n", newText: "same\nA\nend\nplus\n", oldStart: 10, newStart: 20 }]} expandKey="split" /></ExpandKeyProvider>);
  const pairs = [...container.querySelectorAll("[data-diff-pair]")].map(row => [...row.querySelectorAll("[data-diff-code]")].map(cell => cell.textContent));
  expect(pairs).toEqual([["same", "same"], ["a", "A"], ["b", ""], ["end", "end"], ["", "plus"]]);
  expect([...container.querySelectorAll("[data-diff-marker] [aria-hidden]")].map(e => e.textContent)).toEqual(["−", "+", "−", "+"]);
  expect(container.querySelectorAll("[data-diff-view]")).toHaveLength(1);
});
it("split shares the large-diff cap and disclosure", () => {
  const { container } = render(<ExpandKeyProvider value="split-cap"><DiffComparisonBody mode="sideBySide" sections={[{ oldText: "", newText: Array.from({ length: 120 }, (_, i) => `new ${i}`).join("\n") }]} expandKey="cap" /></ExpandKeyProvider>);
  expect(container.querySelectorAll("[data-diff-pair]")).toHaveLength(50);
  fireEvent.click(within(container).getByRole("button", { name: "Show 70 more lines" }));
  expect(container.querySelectorAll("[data-diff-pair]")).toHaveLength(120);
});
