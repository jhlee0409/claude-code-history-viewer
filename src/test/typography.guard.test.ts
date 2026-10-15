import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Type scale guard (plan T4, decision D9).
 *
 * The app has five text sizes - caption 12 / list 13 / body 15 / code 13 /
 * title 17, each multiplied by `--app-font-scale` - plus `text-lg/xl/2xl`,
 * aliases kept only for analytics numbers. Anything else (Tailwind's
 * xs/sm/base, the retired 3xs/2xs/px6-px14 utilities, arbitrary
 * `text-[11px]`, inline `fontSize: 11`, CSS `font-size: 0.75rem`) bypasses
 * the scale: it does not follow the per-language line height, and most of it
 * does not follow the font-size setting either.
 *
 * Scope: every source under src/ except tests (the plan's guard excludes
 * test files). Class names are read from string and template literals
 * (comments excluded), inline sizes from `fontSize` properties / JSX
 * attributes, and stylesheet sizes from `font-size` / `font` declarations
 * and `@apply` rules.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

export const TYPE_TOKENS = ["caption", "list", "body", "code", "title"] as const;
const ANALYTICS_ALIASES = ["lg", "xl", "2xl"] as const;

/** Files whose analytics numbers may use the text-lg/xl/2xl aliases. */
const ANALYTICS_NUMBER_FILES = [
  "src/components/AnalyticsDashboard/",
  "src/components/TokenStatsViewer.tsx",
  "src/components/SessionStatsCard.tsx",
  "src/components/SessionBoard/SessionLane.tsx",
  // `.metric-value` (analytics number utility)
  "src/index.css",
];

const isAnalyticsNumberFile = (relPath: string) =>
  ANALYTICS_NUMBER_FILES.some((prefix) => relPath === prefix || relPath.startsWith(prefix));

const isTestFile = (relPath: string) =>
  /\.test\.(ts|tsx)$/.test(relPath) ||
  relPath.startsWith(`src${sep}test${sep}`) ||
  relPath.startsWith("src/test/") ||
  relPath.includes("__snapshots__") ||
  relPath.includes("__tests__");

/** A text-size utility that is not on the allow-list ("" when the class is fine or not a size). */
export function offScaleTextClass(token: string, { analytics = false } = {}): string {
  // Strip variants (`md:`, `hover:`, `[&>p]:`) and the important modifier.
  const base = token.slice(token.lastIndexOf(":") + 1).replace(/^!|!$/g, "");
  const match = /^text-(.+)$/.exec(base);
  if (!match) return "";
  const value = match[1].replace(/\/.*$/, ""); // text-sm/6 → sm
  if ((TYPE_TOKENS as readonly string[]).includes(value)) return "";
  if ((ANALYTICS_ALIASES as readonly string[]).includes(value)) return analytics ? "" : base;
  if (/^(\d?xs|sm|base|lg|\d?xl|px\d+)$/.test(value)) return base;
  // Arbitrary sizes: text-[11px], text-[0.7rem], text-[length:...], text-[clamp(...)].
  if (/^\[(length:|(\d|\.)[\d.]*(px|rem|em|pt|vw|vh)\]|(clamp|calc|min|max)\()/.test(value)) return base;
  return "";
}

/** Fixed font-size values: px/rem/pt numbers (also inside calc), bare numbers. */
export function isFixedFontSize(value: string): boolean {
  const v = value.trim();
  if (/^var\(--text-(caption|list|body|code|title|lg|xl|2xl)\)$/.test(v)) return false;
  return /(^|[\s(,*/+-])\d*\.?\d+(px|rem|pt)\b/.test(v) || /^\d*\.?\d+$/.test(v);
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

interface Finding {
  file: string;
  line: number;
  what: string;
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** Off-scale class tokens and inline fixed font sizes in a TS(X) source. */
export function scanSource(source: string, fileName: string, { analytics = false } = {}): Finding[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];
  const checkText = (text: string, node: ts.Node) => {
    for (const token of text.split(/[\s"'`{}]+/)) {
      const bad = offScaleTextClass(token, { analytics });
      if (bad) findings.push({ file: fileName, line: lineOf(file, node), what: `class ${bad}` });
    }
    // CSS written inside a string (e.g. a <style> block).
    for (const m of text.matchAll(/font-size\s*:\s*([^;"'`}]+)/g)) {
      if (isFixedFontSize(m[1])) findings.push({ file: fileName, line: lineOf(file, node), what: `font-size: ${m[1].trim()}` });
    }
  };
  const isFontSizeName = (name: ts.PropertyName | ts.JsxAttributeName) =>
    (ts.isIdentifier(name) || ts.isStringLiteral(name)) && (name.text === "fontSize" || name.text === "font-size");
  const checkValue = (value: ts.Expression | undefined, node: ts.Node) => {
    if (!value) return;
    const inner = ts.isJsxExpression(value) ? value.expression : value;
    if (!inner) return;
    if (ts.isNumericLiteral(inner)) {
      findings.push({ file: fileName, line: lineOf(file, node), what: `fontSize ${inner.text}` });
    } else if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
      if (isFixedFontSize(inner.text) || !/^var\(--text-/.test(inner.text.trim())) {
        findings.push({ file: fileName, line: lineOf(file, node), what: `fontSize "${inner.text}"` });
      }
    } else if (ts.isTemplateExpression(inner)) {
      findings.push({ file: fileName, line: lineOf(file, node), what: "fontSize computed template" });
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkText(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      checkText([node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" "), node);
    }
    if (ts.isPropertyAssignment(node) && isFontSizeName(node.name)) checkValue(node.initializer, node);
    if (ts.isJsxAttribute(node) && isFontSizeName(node.name)) {
      const init = node.initializer;
      if (init && (ts.isStringLiteral(init) || ts.isJsxExpression(init))) checkValue(init as ts.Expression, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/** Fixed font sizes and off-scale @apply classes in a stylesheet. */
export function scanStylesheet(css: string, fileName: string, { analytics = false } = {}): Finding[] {
  const findings: Finding[] = [];
  const root = postcss.parse(css, { from: fileName });
  root.walkDecls((decl) => {
    const line = decl.source?.start?.line ?? 0;
    if (decl.prop === "font-size" && isFixedFontSize(decl.value)) {
      findings.push({ file: fileName, line, what: `font-size: ${decl.value}` });
    }
    if (decl.prop === "font" && /\d(px|rem|pt)\b/.test(decl.value)) {
      findings.push({ file: fileName, line, what: `font: ${decl.value}` });
    }
  });
  root.walkAtRules("apply", (rule) => {
    for (const token of rule.params.split(/\s+/)) {
      const bad = offScaleTextClass(token, { analytics });
      if (bad) findings.push({ file: fileName, line: rule.source?.start?.line ?? 0, what: `@apply ${bad}` });
    }
  });
  return findings;
}

const format = (findings: Finding[]) => findings.map((f) => `${f.file}:${f.line} ${f.what}`);

describe("type scale guard: detectors", () => {
  it("flags retired and default sizes, keeps tokens and colours", () => {
    for (const bad of ["text-xs", "text-sm", "text-base", "text-3xs", "text-2xs", "text-px10", "md:text-xs", "!text-sm", "text-sm/6", "text-[11px]", "text-[0.7rem]", "text-[clamp(1rem,2vw,2rem)]", "text-3xl"]) {
      expect(offScaleTextClass(bad), bad).not.toBe("");
    }
    for (const ok of ["text-caption", "text-list", "text-body", "text-code", "text-title", "md:text-list", "text-muted-foreground", "text-[#ff6a2a]", "text-[var(--tool-terminal)]", "text-left", "text-ellipsis"]) {
      expect(offScaleTextClass(ok), ok).toBe("");
    }
    expect(offScaleTextClass("text-2xl")).not.toBe("");
    expect(offScaleTextClass("text-2xl", { analytics: true })).toBe("");
  });

  it("flags inline fixed sizes in TSX and keeps token variables", () => {
    const source = `
      const a = <text fontSize={9} />;
      const b = <div style={{ fontSize: "calc(0.75rem * var(--app-font-scale))" }} />;
      const c = <div style={{ fontSize: 13 }} />;
      const d = <div style={{ fontSize: "var(--text-code)" }} />;
      const e = <div style={{ fontSize: theme.fontSize }} />;
      const f = "<style>p { font-size: 11px }</style>";
    `;
    expect(format(scanSource(source, "x.tsx"))).toEqual([
      "x.tsx:2 fontSize 9",
      'x.tsx:3 fontSize "calc(0.75rem * var(--app-font-scale))"',
      "x.tsx:4 fontSize 13",
      "x.tsx:7 font-size: 11px",
    ]);
  });

  it("flags fixed CSS font sizes and off-scale @apply", () => {
    const css = `.a { font-size: calc(0.6875rem * var(--app-font-scale)); }
.b { font-size: var(--text-caption); }
.c { font-size: 0.75em; }
.d { @apply text-xs font-medium; }
.e { font: 12px/1.4 sans-serif; }`;
    expect(format(scanStylesheet(css, "x.css"))).toEqual([
      "x.css:1 font-size: calc(0.6875rem * var(--app-font-scale))",
      "x.css:5 font: 12px/1.4 sans-serif",
      "x.css:4 @apply text-xs",
    ]);
  });
});

describe("type scale guard: src/", () => {
  const files = walk(SRC, (path) => /\.(ts|tsx|css)$/.test(path)).filter((path) => !isTestFile(relative(ROOT, path)));

  it("scans the app sources", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("uses only the five type tokens (and analytics aliases) - no off-scale classes, inline px or CSS px", () => {
    const findings = files.flatMap((path) => {
      const rel = relative(ROOT, path).split(sep).join("/");
      const options = { analytics: isAnalyticsNumberFile(rel) };
      const source = readFileSync(path, "utf8");
      return path.endsWith(".css") ? scanStylesheet(source, rel, options) : scanSource(source, rel, options);
    });
    expect(format(findings)).toEqual([]);
  });
});
