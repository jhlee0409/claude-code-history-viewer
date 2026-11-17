/**
 * Activity heatmap colors follow the theme.
 *
 * The light theme used to share the dark palette: an empty day was
 * oklch(0.2 …), a near-black square on a white card, so a month with little
 * activity read as a block of black squares. The rule pinned here, per theme:
 * the empty cell sits close to the surface it is drawn on (subtle), and each
 * step of activity moves further away from it (more ink in light, more glow
 * in dark), with a visible lightness gap between steps.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const LEVELS = ["empty", "low", "medium", "high"] as const;

/** Declarations of one top-level rule (`:root` or `.dark`), first match. */
function block(selector: string): string {
  const start = CSS.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function lightness(rule: string, name: string): number {
  const match = rule.match(new RegExp(`--${name}:\\s*oklch\\(\\s*([0-9.]+)`));
  if (!match) throw new Error(`--${name} is not an oklch() value in this block`);
  return Number(match[1]);
}

const MIN_STEP = 0.1;

describe("heatmap tokens", () => {
  it("light: empty is subtle on the card, activity adds ink step by step", () => {
    const root = block(":root");
    const card = lightness(root, "card");
    const [empty, low, medium, high] = LEVELS.map((level) => lightness(root, `heatmap-${level}`));
    expect(card - empty!).toBeLessThanOrEqual(0.1);
    expect(empty! - low!).toBeGreaterThanOrEqual(MIN_STEP);
    expect(low! - medium!).toBeGreaterThanOrEqual(MIN_STEP);
    expect(medium! - high!).toBeGreaterThanOrEqual(MIN_STEP);
  });

  it("dark: empty is subtle on the card, activity adds glow step by step", () => {
    const dark = block(".dark");
    const card = lightness(dark, "card");
    const [empty, low, medium, high] = LEVELS.map((level) => lightness(dark, `heatmap-${level}`));
    expect(Math.abs(empty! - card)).toBeLessThanOrEqual(0.1);
    expect(low! - empty!).toBeGreaterThanOrEqual(MIN_STEP);
    expect(medium! - low!).toBeGreaterThanOrEqual(MIN_STEP);
    expect(high! - medium!).toBeGreaterThanOrEqual(MIN_STEP);
  });
});
