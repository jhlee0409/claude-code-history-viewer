import { describe, expect, it } from "vitest";
import { THEME_NAMES, contrast, createTokenResolver, deltaE00, type ThemeName } from "./utils/oklchContrast";

/**
 * Contrast invariants for the colour tokens in src/index.css.
 *
 * Parses the theme blocks directly (no browser): a token is resolved the
 * way `<html>` gets it in each theme — through the theme's cascade of blocks
 * and `var(--…)` aliases (a cycle, a missing token or a translucent colour
 * fails) — converted from OKLCH to gamut-clipped sRGB, and checked against
 * WCAG 2.x: 4.5 for text, 3.0 for non-text (rings, input borders, marks).
 */

const tokens = createTokenResolver();
const ratio = (theme: ThemeName, fg: string, bg: string) => contrast(tokens.color(theme, fg), tokens.color(theme, bg));

const AA_TEXT = 4.5;
const NON_TEXT = 3;
/** prefers-contrast: more / the high-contrast themes (plan D11). */
const AAA_TEXT = 7;

// ---------------------------------------------------------------------------
// Brand accent (light and dark; the high-contrast themes keep it achromatic)
// ---------------------------------------------------------------------------

// [foreground token, background token]
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["accent", "background"],
  ["accent", "card"],
  ["accent", "popover"],
  ["accent", "muted"],
  ["accent", "secondary"],
  ["accent-foreground", "accent"],
];

const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [["ring", "background"]];

const BRAND_TOKENS = ["accent", "ring"] as const;

describe("theme contrast invariants", () => {
  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    it.each(TEXT_PAIRS)("--%s on --%s meets 4.5:1", (fg, bg) => {
      expect(ratio(theme, fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it.each(NON_TEXT_PAIRS)("--%s against --%s meets 3:1", (fg, bg) => {
      expect(ratio(theme, fg, bg)).toBeGreaterThanOrEqual(NON_TEXT);
    });
  });

  describe.each(["high contrast", "dark high contrast"] as const)("%s theme", (theme) => {
    it.each(BRAND_TOKENS)("--%s stays achromatic", (token) => {
      expect(tokens.color(theme, token)[1]).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Role tokens (inner-UI plan F1a, §4.1)
// ---------------------------------------------------------------------------

/** Surfaces text and rows sit on. */
const SURFACES = [
  "surface-canvas",
  "surface-pane",
  "surface-raised",
  "surface-well",
  "surface-hover",
  "surface-selected",
  "surface-turn-user",
] as const;

const STATUSES = ["danger", "warning", "info", "success"] as const;
const DIFF_SIDES = ["add", "del"] as const;
const CODE_ROLES = ["keyword", "string", "number", "comment", "function", "type", "punct"] as const;

type Pair = readonly [fg: string, bg: string, min: number];

function rolePairs(theme: ThemeName): Pair[] {
  const highContrast = theme === "high contrast" || theme === "dark high contrast";
  const secondaryText = highContrast ? AAA_TEXT : AA_TEXT;
  const pairs: Pair[] = [];
  // Text: --fg / --fg-2 / --fg-3 on every surface (no opacity dimming).
  for (const bg of SURFACES) {
    pairs.push(["fg", bg, AA_TEXT], ["fg-2", bg, AA_TEXT], ["fg-3", bg, AA_TEXT]);
  }
  // High contrast (and so prefers-contrast: more, F1b): secondary text ≥ 7:1 on the canvas.
  pairs.push(["fg-2", "surface-canvas", secondaryText], ["fg-3", "surface-canvas", secondaryText]);
  // Lines: the input border and the selected line are UI components (3:1; 4.5:1 in high contrast).
  for (const bg of ["surface-canvas", "surface-pane", "surface-raised"]) {
    pairs.push(["line-input", bg, highContrast ? AA_TEXT : NON_TEXT], ["line-selected", bg, NON_TEXT]);
  }
  // Focus ring: 3:1 on every surface a focusable element sits on.
  for (const bg of SURFACES) pairs.push(["focus-ring", bg, NON_TEXT]);
  // Status sets: text on its own surface and on the plain surfaces; the line is a visible mark.
  for (const s of STATUSES) {
    pairs.push(
      [`status-${s}-fg`, `status-${s}-surface`, AA_TEXT],
      [`status-${s}-fg`, "surface-canvas", AA_TEXT],
      [`status-${s}-fg`, "surface-pane", AA_TEXT],
      [`status-${s}-fg`, "surface-well", AA_TEXT],
      [`status-${s}-line`, "surface-canvas", NON_TEXT],
      [`status-${s}-line`, "surface-well", NON_TEXT],
      ["fg", `status-${s}-surface`, AA_TEXT],
    );
  }
  // Search highlight: the matched text stays readable on both steps.
  pairs.push(
    ["highlight-search-fg", "highlight-search-bg", AA_TEXT],
    ["highlight-search-fg", "highlight-search-current", AA_TEXT],
  );
  // Diff (Q1): marker/text colour on the line, the gutter and the word mark; underline mark 3:1.
  for (const side of DIFF_SIDES) {
    pairs.push(
      [`diff-${side}-fg`, `diff-${side}-bg`, AA_TEXT],
      [`diff-${side}-fg`, `diff-${side}-gutter`, AA_TEXT],
      [`diff-${side}-fg`, `diff-word-${side}-bg`, AA_TEXT],
      ["fg", `diff-${side}-bg`, AA_TEXT],
      ["fg", `diff-word-${side}-bg`, AA_TEXT],
      [`diff-word-${side}-mark`, `diff-word-${side}-bg`, NON_TEXT],
    );
  }
  pairs.push(["diff-hunk-fg", "surface-well", AA_TEXT], ["diff-context-fg", "surface-well", AA_TEXT]);
  // Code (syntax) colours on the well they render in.
  for (const role of CODE_ROLES) pairs.push([`code-${role}`, "surface-well", AA_TEXT]);
  return pairs;
}

describe("role token contrast (F1a)", () => {
  describe.each(THEME_NAMES)("%s theme", (theme) => {
    it.each(rolePairs(theme))("--%s on --%s meets %s:1", (fg, bg, min) => {
      const r = ratio(theme, fg, bg);
      expect(r, `${theme}: --${fg} on --${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
    });

    it("the search highlight is a different colour from the warning surface (ΔE00 ≥ 10)", () => {
      for (const step of ["highlight-search-bg", "highlight-search-current"]) {
        const d = deltaE00(tokens.color(theme, step), tokens.color(theme, "status-warning-surface"));
        expect(d, `${theme}: --${step} vs --status-warning-surface ΔE00 ${d.toFixed(1)}`).toBeGreaterThanOrEqual(10);
      }
    });

    it("added and removed lines differ by more than colour noise (ΔE00 ≥ 10)", () => {
      for (const [a, b] of [
        ["diff-add-bg", "diff-del-bg"],
        ["diff-word-add-bg", "diff-word-del-bg"],
      ] as const) {
        const d = deltaE00(tokens.color(theme, a), tokens.color(theme, b));
        expect(d, `${theme}: --${a} vs --${b} ΔE00 ${d.toFixed(1)}`).toBeGreaterThanOrEqual(10);
      }
    });

    it("hover and selected are one step each: distinct from the pane and from each other", () => {
      const pane = tokens.color(theme, "surface-pane");
      const hover = tokens.color(theme, "surface-hover");
      const selected = tokens.color(theme, "surface-selected");
      expect(deltaE00(pane, hover)).toBeGreaterThan(1);
      expect(deltaE00(hover, selected)).toBeGreaterThan(1);
    });
  });
});
