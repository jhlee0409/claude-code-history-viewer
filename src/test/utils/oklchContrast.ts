/**
 * WCAG contrast of the colour tokens in `src/index.css`, read straight from
 * the stylesheet: OKLCH -> OKLab -> linear sRGB (clipped to the sRGB gamut, as
 * a browser paints it) -> WCAG 2 relative luminance.
 */
import fs from "node:fs";
import path from "node:path";

export type Oklch = [number, number, number];

const CSS = fs.readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

/** Declarations of one top-level rule (`:root`, `.dark`, `.dark.high-contrast`), first match. */
export function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = CSS.search(new RegExp(`^${escaped}\\s*\\{`, "m"));
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

/** An opaque `--name: oklch(L C H)` declaration of `rule`. */
export function oklch(rule: string, name: string): Oklch {
  const match = rule.match(
    new RegExp(`--${name}:\\s*oklch\\(\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\s*\\)`)
  );
  if (!match) throw new Error(`--${name} is not an opaque oklch(L C H) value in this block`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** WCAG relative luminance of an oklch colour (gamut-clipped sRGB). */
export function luminance([l, c, h]: Oklch): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  // Clip in gamma-encoded sRGB (what a browser paints), then back to linear.
  const [r, g, bl] = linear.map((v) => {
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
    const clipped = Math.min(1, Math.max(0, encoded));
    return clipped <= 0.04045 ? clipped / 12.92 : ((clipped + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** WCAG 2 contrast ratio of two colours (order-independent). */
export function contrast(x: Oklch, y: Oklch): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
