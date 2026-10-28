#!/usr/bin/env node
/** F1c numeric gate. Node >=20; no colour dependency.
 * node scripts/tokens/series-check.mjs [--candidate file.json]
 * Candidate shape: { light: [[L,C,H], ...four], dark: [[L,C,H], ...four] }.
 * Report is always printed; exit 1 means a measured threshold failed (not impossible).
 * Colours never replace direct labels, legends, line/point shapes or patterns.
 */
import { readFileSync } from "node:fs";
import { CVD_MODES, THEME_NAMES, contrast, createTokenResolver, deltaE00, srgb8 } from "./color.mjs";

const tokens = createTokenResolver();
const categories = ["series-1", "series-2", "series-3", "series-4"];
const marks = [...categories, "series-scalar", "series-scalar-soft", "series-prior"];
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--candidate")) {
  throw new Error("Usage: series-check.mjs [--candidate file.json]");
}
const candidate = args.length ? JSON.parse(readFileSync(args[1], "utf8")) : null;
if (candidate) {
  for (const theme of ["light", "dark"]) {
    const colors = candidate[theme];
    if (!Array.isArray(colors) || colors.length !== 4 || colors.some((c) => !Array.isArray(c) || c.length !== 3 || c.some((v) => typeof v !== "number" || !Number.isFinite(v)) || c[0] < 0 || c[0] > 1 || c[1] < 0 || c[2] < 0 || c[2] > 360)) {
      throw new Error(`Invalid ${theme} candidate: exactly four finite opaque OKLCH triples required`);
    }
  }
}
const color = (theme, name) => {
  const i = categories.indexOf(name);
  return candidate && i >= 0 ? candidate[theme.startsWith("dark") ? "dark" : "light"][i] : tokens.color(theme, name);
};
const report = {
  source: candidate ? args[1] : "src/index.css",
  method: "OKLCH → clipped linear sRGB → Machado 2009 severity 1.0 → clipped linear sRGB → CIELAB D65 → CIEDE2000; unrounded thresholds",
  thresholds: { contrast: 3, deltaE00: 10 },
  contrast: [], pairs: [], pass: true,
};
for (const theme of THEME_NAMES) {
  for (const name of marks) {
    const value = color(theme, name);
    const ratio = contrast(value, tokens.color(theme, "card"));
    report.contrast.push({ theme, token: name, oklch: value, srgb8: srgb8(value), ratio, pass: ratio >= report.thresholds.contrast });
  }
  for (const [i, a] of categories.entries()) {
    for (const b of categories.slice(i + 1)) {
      for (const mode of [undefined, ...CVD_MODES]) {
        const distance = deltaE00(color(theme, a), color(theme, b), mode);
        report.pairs.push({ theme, a, b, mode: mode ?? "normal", deltaE00: distance, pass: distance >= report.thresholds.deltaE00 });
      }
    }
  }
}
report.pass = [...report.contrast, ...report.pairs].every((row) => row.pass);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.pass ? 0 : 1;
