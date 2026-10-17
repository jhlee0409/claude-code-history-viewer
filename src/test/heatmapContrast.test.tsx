/**
 * Heatmap day numbers are readable on every cell.
 *
 * The day number ("1", for orientation) used to be `text-foreground/40` on
 * every intensity: about 1.85-2.63:1 in the light theme. Each intensity now
 * has its own opaque text token, and every pair must reach WCAG AA for small
 * text (4.5:1) in light and dark. Ratios are computed from the oklch() tokens
 * in index.css (OKLab -> linear sRGB, clipped to the sRGB gamut) with the
 * WCAG 2 relative-luminance formula. The weekday header above the grid is
 * small text on the card and is held to the same bar.
 */
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ActivityHeatmapComponent } from "@/components/AnalyticsDashboard/components/ActivityHeatmap";
import { getHeatColor, getHeatTextColor } from "@/components/AnalyticsDashboard/utils";
import type { DailyStats } from "@/types";
import { block, contrast, oklch } from "./utils/oklchContrast";

const LEVELS = ["empty", "low", "medium", "high"] as const;
const AA_SMALL_TEXT = 4.5;

describe("heatmap text contrast (WCAG AA, small text)", () => {
  it("the converter matches known values (white 21:1 on black, mid grey)", () => {
    expect(contrast([1, 0, 0], [0, 0, 0])).toBeCloseTo(21, 1);
    // oklch(0.6 0 0) is sRGB ~#7f7f7f-ish: ~4.0:1 on white.
    expect(contrast([0.6, 0, 0], [1, 0, 0])).toBeGreaterThan(3.5);
    expect(contrast([0.6, 0, 0], [1, 0, 0])).toBeLessThan(4.5);
  });

  for (const theme of [":root", ".dark"] as const) {
    const label = theme === ":root" ? "light" : "dark";
    for (const level of LEVELS) {
      it(`${label}: day number on the ${level} cell reaches ${AA_SMALL_TEXT}:1`, () => {
        const rule = block(theme);
        const ratio = contrast(oklch(rule, `heatmap-${level}-foreground`), oklch(rule, `heatmap-${level}`));
        expect(ratio, `${label} ${level}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
      });
    }

    it(`${label}: weekday header (muted foreground) on the card reaches ${AA_SMALL_TEXT}:1`, () => {
      const rule = block(theme);
      const ratio = contrast(oklch(rule, "muted-foreground"), oklch(rule, "card"));
      expect(ratio, `${label}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
  }
});

describe("ActivityHeatmap draws each day number in its cell's text token", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  const day = (date: string, message_count: number): DailyStats => ({
    date,
    message_count,
    session_count: 1,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    active_hours: 1,
  });

  // One "1" per month, at each intensity: Jan empty, Feb low, Mar medium, Apr high.
  const data = [
    day("2025-01-15", 10),
    day("2025-02-01", 20),
    day("2025-03-01", 50),
    day("2025-04-01", 100),
  ];

  it("opaque, per-intensity text colour (no alpha modifier) for every intensity", () => {
    const { container } = render(<ActivityHeatmapComponent data={data} />);
    const firsts = Array.from(container.querySelectorAll("button span")).filter((s) => s.textContent === "1");
    expect(firsts).toHaveLength(4);
    const seen = new Set<string>();
    for (const span of firsts) {
      const cell = span.closest("button") as HTMLElement;
      const background = cell.style.backgroundColor;
      const level = LEVELS.find((l) => background === `var(--heatmap-${l})`);
      expect(level, `cell background ${background}`).toBeDefined();
      expect((span as HTMLElement).style.color).toBe(`var(--heatmap-${level}-foreground)`);
      expect(span.className).not.toMatch(/text-[a-z-]+\/\d+/);
      seen.add(level!);
    }
    expect([...seen].sort()).toEqual([...LEVELS].sort());
  });

  it("text and fill tokens come from the same intensity buckets", () => {
    for (const intensity of [0, 0.1, 0.3, 0.31, 0.6, 0.61, 1]) {
      const fill = getHeatColor(intensity).match(/--heatmap-([a-z]+)/)?.[1];
      expect(getHeatTextColor(intensity)).toBe(`var(--heatmap-${fill}-foreground)`);
    }
  });

  it("weekday header text is opaque", () => {
    const { container } = render(<ActivityHeatmapComponent data={data} />);
    const header = container.querySelector(".grid.grid-cols-7 > div");
    expect(header?.className).toContain("text-muted-foreground");
    expect(header?.className).not.toMatch(/text-muted-foreground\/\d+/);
  });
});
