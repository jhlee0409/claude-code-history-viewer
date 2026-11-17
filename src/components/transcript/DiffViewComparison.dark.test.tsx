/**
 * Side by side behind the diff's `…` menu follows the app theme (TR2a, D5
 * "다크 흰 표 0").
 *
 * The side-by-side viewer (react-diff-viewer) moved behind the menu
 * unchanged; its own default is a white table. In the dark app theme it
 * takes the viewer's dark switch, so its table does not resolve to a white
 * background. In the light theme it stays as it was.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThemeContext, type Theme } from "@/contexts/theme/context";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { DiffComparisonBody } from "./DiffViewComparison";

const WHITE = /^(?:#fff(?:fff)?|white|rgb\(255,\s*255,\s*255\))$/i;

const showSideBySide = (isDarkMode: boolean) =>
  render(
    <ThemeContext.Provider
      value={{
        theme: (isDarkMode ? "dark" : "light") as Theme,
        isDarkMode,
        setTheme: async () => {},
        initializeTheme: async () => {},
      }}
    >
      <ExpandKeyProvider value="theme-diff"><DiffComparisonBody
        mode="sideBySide"
        sections={[{ oldText: "const a = 1;\nconst b = 2;\n", newText: "const a = 1;\nconst b = 3;\n" }]}
        filePath="src/a.ts"
        expandKey="side-by-side-dark"
      /></ExpandKeyProvider>
    </ThemeContext.Provider>,
  );

const tableBackground = (container: HTMLElement) => {
  const root = container.querySelector("[data-diff-mode='sideBySide']");
  expect(root, "the side-by-side root ([data-diff-mode=sideBySide])").not.toBeNull();
  const table = root?.querySelector("table");
  expect(table, "the side-by-side table").not.toBeNull();
  return getComputedStyle(table as HTMLElement).backgroundColor.trim();
};

describe("side by side in the … menu follows the app theme", () => {
  it("dark theme: the side-by-side table does not resolve to a white background", () => {
    const { container } = showSideBySide(true);
    const background = tableBackground(container);
    expect(background, "computed table background in dark").not.toBe("");
    expect(background).not.toMatch(WHITE);
  });

  it("light theme: the side-by-side table keeps its light background", () => {
    const { container } = showSideBySide(false);
    expect(container.querySelector("[data-diff-view]")?.className).toContain("bg-surface-well");
    expect(tableBackground(container)).not.toMatch(WHITE);
  });
});
