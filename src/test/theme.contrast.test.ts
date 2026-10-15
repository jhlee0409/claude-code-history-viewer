import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast invariants for the brand accent tokens in src/index.css.
 *
 * Parses the theme blocks directly (no browser), converts OKLCH to sRGB with
 * gamut clipping, and checks WCAG 2.x contrast ratios. Thresholds: 4.5 for
 * text pairs, 3.0 for non-text (focus ring).
 */

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const THEMES = [
  { name: "light", selector: ":root" },
  { name: "dark", selector: ".dark" },
] as const;

const HIGH_CONTRAST_THEMES = [".high-contrast", ".dark.high-contrast"] as const;

// [foreground token, background token]
const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["--accent", "--background"],
  ["--accent", "--card"],
  ["--accent", "--popover"],
  ["--accent", "--muted"],
  ["--accent", "--secondary"],
  ["--accent-foreground", "--accent"],
];

const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [["--ring", "--background"]];

const BRAND_TOKENS = ["--accent", "--ring"] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Body of the first top-level block whose line starts with exactly `selector {`. */
function themeBlock(selector: string): string {
  const match = new RegExp(`^${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "m").exec(CSS);
  if (!match?.[1]) throw new Error(`theme block not found: ${selector}`);
  return match[1];
}

function tokenValue(block: string, token: string): string {
  const match = new RegExp(`(?:^|[\\s;])${escapeRegExp(token)}:\\s*([^;]+);`).exec(block);
  if (!match?.[1]) throw new Error(`token not found: ${token}`);
  return match[1].trim();
}

type Oklch = { l: number; c: number; h: number };

function parseOklch(value: string): Oklch {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!match) throw new Error(`not an opaque oklch() value: ${value}`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** OKLCH -> linear sRGB, clipped to the sRGB gamut. */
function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

function relativeLuminance(color: Oklch): number {
  const [r, g, b] = toLinearSrgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme contrast invariants", () => {
  describe.each(THEMES)("$name theme ($selector)", ({ selector }) => {
    const block = themeBlock(selector);
    const color = (token: string) => parseOklch(tokenValue(block, token));

    it.each(TEXT_PAIRS)("%s on %s meets 4.5:1", (fg, bg) => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
    });

    it.each(NON_TEXT_PAIRS)("%s against %s meets 3:1", (fg, bg) => {
      expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(3);
    });
  });

  describe.each(HIGH_CONTRAST_THEMES)("%s", (selector) => {
    it.each(BRAND_TOKENS)("%s stays achromatic", (token) => {
      expect(parseOklch(tokenValue(themeBlock(selector), token)).c).toBe(0);
    });
  });
});
