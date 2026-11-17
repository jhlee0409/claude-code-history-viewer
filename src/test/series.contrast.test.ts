import { describe, expect, it } from "vitest";
import { THEME_NAMES, CVD_MODES, createTokenResolver, contrast, deltaE00 } from "./utils/oklchContrast";

const tokens = createTokenResolver();
const SERIES = ["series-1", "series-2", "series-3", "series-4"] as const;

describe("F1c measured data family", () => {
  describe.each(THEME_NAMES)("%s", (theme) => {
    it.each([...SERIES, "series-scalar", "series-scalar-soft", "series-prior"])("--%s on card is at least 3:1", (name) => {
      expect(tokens.winner(theme, name), `missing --${name}`).not.toBeNull();
      expect(contrast(tokens.color(theme, name), tokens.color(theme, "card"))).toBeGreaterThanOrEqual(3);
      expect(tokens.value(theme, `color-${name}`)).toBe(tokens.value(theme, name));
    });
    it("all six category pairs have ΔE00 >= 10 normally and after each Machado simulation", () => {
      expect(tokens.winner(theme, SERIES[0]), "missing categorical family").not.toBeNull();
      for (const [i, a] of SERIES.entries()) {
        for (const b of SERIES.slice(i + 1)) {
          for (const mode of [undefined, ...CVD_MODES]) {
            const d = deltaE00(tokens.color(theme, a), tokens.color(theme, b), mode);
            expect(d, `${theme} ${a}/${b} ${mode ?? "normal"}: ${d}`).toBeGreaterThanOrEqual(10);
          }
        }
      }
    });
    it("axis labels are readable and the grid resolves to the existing structural line", () => {
      expect(tokens.winner(theme, "chart-axis"), "missing axis role").not.toBeNull();
      expect(contrast(tokens.color(theme, "chart-axis"), tokens.color(theme, "card"))).toBeGreaterThanOrEqual(4.5);
      expect(tokens.value(theme, "chart-grid")).toBe(tokens.value(theme, "line-faint"));
    });
  });
});
