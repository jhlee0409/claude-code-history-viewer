import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Type scale guard (plan T4, decision D9).
 *
 * The app has five text sizes - caption 12 / list 13 / body 15 / code 13 /
 * title 17, each multiplied by `--app-font-scale` - plus `text-lg/xl/2xl`,
 * aliases kept only for analytics numbers. Anything else (Tailwind's
 * xs/sm/base, the retired 3xs/2xs/px6-px14 utilities, arbitrary
 * `text-[11px]` / `text-[length:...]`, inline `fontSize: 11`, CSS
 * `font-size: 0.75rem / 0.7em / 80%`) bypasses the scale: it does not follow
 * the per-language line height, and most of it does not follow the font-size
 * setting either.
 *
 * Scope: every source under src/ except tests (the plan's guard excludes
 * test files). The TypeScript checker resolves values, so the guard sees
 * through constants, `as const` objects, conditionals and concatenation:
 * - class names: every string, template and `+` expression is folded to its
 *   possible values; a `text-` utility followed by a value the checker
 *   cannot resolve (`"text-" + size`, `` `text-${size}` ``) is a finding.
 * - inline sizes (`fontSize` properties, shorthand, computed names, JSX
 *   attributes, `style.fontSize =`, `setProperty("font-size")`) must resolve
 *   to `var(--text-<token>)`; numbers and unresolved values are findings.
 *   Property keys resolve through the checker too (`const K = "fontSize";
 *   { [K]: 13 }`, `style[K] = ...`, `setProperty(K, ...)`); a key typed only
 *   as `string` is not constant and is skipped.
 * - inline `font` shorthand (objects, `style.font =`, `setProperty("font")`,
 *   CSS in strings): its size part must be `var(--text-<token>)`, or the
 *   whole value a CSS-wide keyword.
 * - stylesheets: `font-size` must be `var(--text-<token>)` or a CSS-wide
 *   keyword; the `font` shorthand only a CSS-wide keyword; `@apply` classes
 *   follow the class rules.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

export const TYPE_TOKENS = ["caption", "list", "body", "code", "title"] as const;
const ANALYTICS_ALIASES = ["lg", "xl", "2xl"] as const;
const CSS_WIDE_KEYWORDS = ["inherit", "initial", "unset", "revert", "revert-layer"];

/** Files whose analytics numbers may use the text-lg/xl/2xl aliases. */
const ANALYTICS_NUMBER_FILES = [
  "src/components/AnalyticsDashboard/",
  "src/components/TokenStatsViewer.tsx",
  "src/components/SessionStatsCard.tsx",
  "src/components/SessionBoard/SessionLane.tsx",
  // `.metric-value` (analytics number utility)
  "src/index.css",
];

/**
 * Standalone documents the app writes out (HTML export): their embedded
 * stylesheet has its own relative sizes and no app tokens, so CSS inside
 * their strings is not checked. Their classes and inline sizes still are.
 */
const STANDALONE_DOCUMENT_FILES = ["src/services/export/htmlExporter.ts"];

const isAnalyticsNumberFile = (relPath: string) =>
  ANALYTICS_NUMBER_FILES.some((prefix) => relPath === prefix || relPath.startsWith(prefix));

const isTestFile = (relPath: string) =>
  /\.test\.(ts|tsx)$/.test(relPath) ||
  relPath.startsWith(`src${sep}test${sep}`) ||
  relPath.startsWith("src/test/") ||
  relPath.includes("__snapshots__") ||
  relPath.includes("__tests__");

interface Options {
  analytics?: boolean;
  /** Skip `font-size` inside strings (STANDALONE_DOCUMENT_FILES). */
  standaloneDocument?: boolean;
}

const allowedSizeNames = ({ analytics = false }: Options): readonly string[] =>
  analytics ? [...TYPE_TOKENS, ...ANALYTICS_ALIASES] : TYPE_TOKENS;

/** `var(--text-<token>)` (analytics aliases only where allowed). */
export function isTokenVariable(value: string, options: Options = {}): boolean {
  const m = /^var\(\s*--text-([\w-]+)\s*\)$/.exec(value.trim());
  return !!m?.[1] && allowedSizeNames(options).includes(m[1]);
}

/** Index of the last `sep` outside brackets/parentheses (-1 if none). */
function lastTopLevel(token: string, sepChar: string): number {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if ((c === "]" || c === ")") && depth > 0) depth--;
    else if (c === sepChar && depth === 0) last = i;
  }
  return last;
}

/** Index of the first `sep` outside brackets/parentheses (-1 if none). */
function topLevelIndex(token: string, sepChar: string): number {
  let depth = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if ((c === "]" || c === ")") && depth > 0) depth--;
    else if (c === sepChar && depth === 0) return i;
  }
  return -1;
}

/** The utility of a class token without variants (`md:`, `[&>p]:`) and `!`. */
function utilityOf(token: string): string {
  return token.slice(lastTopLevel(token, ":") + 1).replace(/^!|!$/g, "");
}

const COLOR_VALUE =
  /^(#[\da-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)|currentcolor|transparent)$/i;

/** A text-size utility that is not on the allow-list ("" when the class is fine or not a size). */
export function offScaleTextClass(token: string, options: Options = {}): string {
  const base = utilityOf(token);
  const match = /^text-(.+)$/.exec(base);
  if (!match) return "";
  // text-sm/6, text-[13px]/6 → drop the line-height modifier
  const raw = match[1] ?? "";
  const slash = lastTopLevel(raw, "/");
  const value = slash === -1 ? raw : raw.slice(0, slash);

  const arbitrary = /^\[(.*)\]$/.exec(value) ?? /^\((.*)\)$/.exec(value);
  if (arbitrary) {
    const inner = (arbitrary[1] ?? "").trim();
    const isShorthand = value.startsWith("("); // text-(--x) = text-[var(--x)]
    const hinted = /^([\w-]+):(.*)$/.exec(inner);
    if (hinted) {
      const [, hint = "", rest = ""] = hinted;
      if (hint === "color") return "";
      const size = isShorthand ? `var(${rest})` : rest;
      return hint === "length" && isTokenVariable(size, options) ? "" : base;
    }
    const variable = isShorthand ? `var(${inner})` : inner;
    if (/^var\(--[\w-]+\)$/.test(variable)) {
      // Tailwind reads an unhinted variable as a colour; --text-* is a size.
      return /^var\(--text-/.test(variable) ? base : "";
    }
    if (COLOR_VALUE.test(inner)) return "";
    // Everything else bracketed is a size (13px, 1.1em, 80%, larger, calc(...)).
    return base;
  }

  if ((TYPE_TOKENS as readonly string[]).includes(value)) return "";
  if ((ANALYTICS_ALIASES as readonly string[]).includes(value)) return options.analytics ? "" : base;
  if (/^(\d*xs|sm|base|lg|\d*xl|px\d+)$/.test(value)) return base;
  return "";
}

/** Size names Tailwind (or the retired scale) knows after `text-`. */
const SIZE_NAMES = ["xs", "2xs", "3xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl", "px"];

/**
 * Whether a class token with an unresolved part (UNKNOWN) may be a text size:
 * `text-` directly before it, an arbitrary `text-[` / `text-(` around it, or
 * a known prefix of a size name (`text-x${s}`). `text-editor-${id}` is not.
 */
function mayBeDynamicTextSize(token: string): boolean {
  const utility = utilityOf(token.slice(0, token.indexOf(UNKNOWN)) + UNKNOWN);
  if (!utility.startsWith("text-")) return false;
  const prefix = utility.slice("text-".length, utility.indexOf(UNKNOWN));
  return prefix === "" || /^[[(]/.test(prefix) || /^\d+$/.test(prefix) || /^px\d*$/.test(prefix) || SIZE_NAMES.some((name) => name.startsWith(prefix));
}

/** A CSS `font-size` value outside the type scale (CSS-wide keywords are fine). */
export function isOffScaleFontSize(value: string, options: Options = {}): boolean {
  const v = value.trim().replace(/\s*!important$/, "");
  return !CSS_WIDE_KEYWORDS.includes(v) && !isTokenVariable(v, options);
}

/** Split a CSS value on top-level whitespace (not inside parentheses or quotes). */
function cssTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const c of value) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
    else if (/\s/.test(c) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Keywords and numbers that may precede the size in the `font` shorthand. */
const FONT_PREFIX = /^(normal|italic|oblique|small-caps|bold|bolder|lighter|(ultra-|extra-|semi-)?(condensed|expanded)|-?[\d.]+(deg|grad|rad|turn)?)$/i;

/**
 * A `font` shorthand value whose size is not a type token. The size is the
 * part before `/line-height`, or else the first part after the optional
 * style/variant/weight/stretch prefix; only CSS-wide keywords and a
 * `var(--text-<token>)` size pass (system fonts like `caption` set a size too).
 */
export function isOffScaleFontShorthand(value: string, options: Options = {}): boolean {
  const v = value.trim().replace(/\s*!important$/, "");
  if (CSS_WIDE_KEYWORDS.includes(v)) return false;
  // `size/line-height` (or `size / line-height`): the size sits right before the slash.
  const tokens = cssTokens(v).flatMap((token) => {
    const slash = topLevelIndex(token, "/");
    return slash === -1 ? [token] : [token.slice(0, slash), "/", token.slice(slash + 1)].filter(Boolean);
  });
  const slashAt = tokens.indexOf("/");
  const size = slashAt !== -1 ? tokens[slashAt - 1] : tokens.find((t) => !FONT_PREFIX.test(t));
  return !size || !isTokenVariable(size, options);
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

/** Stand-in for a part of a string the checker cannot resolve. */
const UNKNOWN = "\u0000";
/** Folding stops beyond this many alternatives (the result is then unknown). */
const MAX_ALTERNATIVES = 64;

type Value = string | number;

/**
 * Every value `expr` can take, or null when it cannot be resolved statically.
 * With `partial`, unresolved parts of a string become UNKNOWN instead.
 */
function possibleValues(expr: ts.Expression, checker: ts.TypeChecker, partial = false): Value[] | null {
  const unknown = partial ? [UNKNOWN] : null;
  const product = (parts: Array<Value[] | null>, join: (a: Value, b: Value) => Value): Value[] | null => {
    let acc: Value[] = [""];
    for (const part of parts) {
      if (!part) return null;
      acc = acc.flatMap((a) => part.map((b) => join(a, b)));
      if (acc.length > MAX_ALTERNATIVES) return unknown;
    }
    return acc;
  };
  const concat = (a: Value, b: Value) => `${a}${b}`;

  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    // `x as const` keeps x's literal; `x as string` must not widen what x is.
    return possibleValues(expr.expression, checker, partial);
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)];
  if (ts.isTemplateExpression(expr)) {
    return product(
      [[expr.head.text], ...expr.templateSpans.flatMap((span) => [possibleValues(span.expression, checker, partial) ?? unknown, [span.literal.text]])],
      concat,
    );
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = possibleValues(expr.left, checker, partial) ?? unknown;
    const right = possibleValues(expr.right, checker, partial) ?? unknown;
    return product([left, right], (a, b) => (typeof a === "number" && typeof b === "number" ? a + b : `${a}${b}`));
  }
  if (ts.isConditionalExpression(expr)) {
    const a = possibleValues(expr.whenTrue, checker, partial);
    const b = possibleValues(expr.whenFalse, checker, partial);
    return a && b ? [...a, ...b] : unknown;
  }
  if (
    ts.isBinaryExpression(expr) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expr.operatorToken.kind)
  ) {
    const a = possibleValues(expr.left, checker, partial);
    const b = possibleValues(expr.right, checker, partial);
    return a && b ? [...a, ...b] : unknown;
  }
  // Identifiers, property access, calls: whatever literal type the checker knows.
  const type = checker.getTypeAtLocation(expr);
  const literals: Value[] = [];
  for (const member of type.isUnion() ? type.types : [type]) {
    if (member.isStringLiteral() || member.isNumberLiteral()) literals.push(member.value);
    else if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
    else return unknown;
  }
  return literals.length ? literals : unknown;
}

/** Off-scale class tokens and inline sizes in a TS(X) source file of a program. */
function scanProgramFile(file: ts.SourceFile, checker: ts.TypeChecker, fileName: string, options: Options = {}): Finding[] {
  const findings = new Map<string, Finding>();
  const report = (node: ts.Node, what: string) => {
    const line = lineOf(file, node);
    findings.set(`${line} ${what}`, { file: fileName, line, what });
  };

  const checkClassText = (text: string, node: ts.Node) => {
    for (const token of text.split(/[\s"'`{}]+/)) {
      if (token.includes(UNKNOWN)) {
        if (mayBeDynamicTextSize(token)) report(node, `class ${token.replaceAll(UNKNOWN, "${…}")} (unresolved text-* class)`);
        continue;
      }
      const bad = offScaleTextClass(token, options);
      if (bad) report(node, `class ${bad}`);
    }
    // CSS written inside a string (e.g. a <style> block).
    if (options.standaloneDocument) return;
    for (const m of text.matchAll(/font-size\s*:\s*([^;"'`}]+)/g)) {
      const value = m[1] ?? "";
      if (isOffScaleFontSize(value, options)) report(node, `font-size: ${value.trim()}`);
    }
    for (const m of text.matchAll(/(?<![\w-])font\s*:\s*([^;"'`}]+)/g)) {
      const value = m[1] ?? "";
      if (isOffScaleFontShorthand(value, options)) report(node, `font: ${value.trim()}`);
    }
  };

  type SizeProperty = "fontSize" | "font";
  const isOffScale = (property: SizeProperty, v: Value) =>
    typeof v === "number" || (property === "font" ? isOffScaleFontShorthand(v, options) : !isTokenVariable(v, options));

  /** A value written to `fontSize` / `font`: it must resolve to the type scale. */
  const checkSizeValue = (property: SizeProperty, value: ts.Expression | undefined, node: ts.Node) => {
    if (!value) return;
    // A config group, not a CSS value (tailwind-merge's `fontSize: [{ text: [...] }]`).
    if (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value)) return;
    const values = possibleValues(value, checker);
    const shown = value.getText(file);
    if (!values) return report(node, `${property} ${shown} (unresolved)`);
    for (const v of values) {
      if (isOffScale(property, v)) report(node, `${property} ${typeof v === "number" ? v : `"${v}"`}`);
    }
  };

  /** CSS properties that set a size, by the names they are written under. */
  const SIZE_PROPERTY_NAMES: Record<string, SizeProperty> = { fontSize: "fontSize", "font-size": "fontSize", font: "font" };

  /** The size properties among a key's possible names. */
  const sizePropertiesOf = (names: Value[] | null): SizeProperty[] => [
    ...new Set((names ?? []).map((n) => SIZE_PROPERTY_NAMES[String(n)]).filter((p) => p !== undefined)),
  ];
  /** Names of a declared property: `fontSize`, `"font-size"`, `[K]`. */
  const declaredNames = (name: ts.PropertyName | ts.MemberName): Value[] | null => {
    if (ts.isComputedPropertyName(name)) return possibleValues(name.expression, checker);
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return [name.text];
    return null;
  };

  /**
   * `{ fontSize: x }`, `{ [K]: x }`, `el.style.font = x` (a declared name) or
   * `style[K] = x`, `setProperty(K, x)` (a key expression). Keys resolve via
   * the checker; a key typed only as `string` is not a constant and is skipped.
   */
  const checkSizeWrite = (names: Value[] | null, value: ts.Expression | undefined, node: ts.Node) => {
    for (const property of sizePropertiesOf(names)) checkSizeValue(property, value, node);
  };

  const isPartOfLargerString = (node: ts.Node): boolean => {
    const parent = node.parent;
    return (
      (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
      ts.isTemplateSpan(parent) ||
      (ts.isParenthesizedExpression(parent) && isPartOfLargerString(parent))
    );
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkClassText(node.text, node);
    } else if (
      (ts.isTemplateExpression(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)) &&
      !isPartOfLargerString(node)
    ) {
      const values = possibleValues(node, checker, true) ?? [UNKNOWN];
      for (const v of values) if (typeof v === "string") checkClassText(v, node);
    }

    if (ts.isPropertyAssignment(node)) checkSizeWrite(declaredNames(node.name), node.initializer, node);
    if (ts.isShorthandPropertyAssignment(node)) checkSizeWrite(declaredNames(node.name), node.name, node);
    // SVG `fontSize` attribute (a `font` JSX prop is a component's own prop, not CSS).
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && SIZE_PROPERTY_NAMES[node.name.text] === "fontSize") {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) checkSizeValue("fontSize", init, node);
      else if (init && ts.isJsxExpression(init)) checkSizeValue("fontSize", init.expression, node);
    }
    // el.style.fontSize = x, el.style[K] = x
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(node.left)) checkSizeWrite(declaredNames(node.left.name), node.right, node);
      else if (ts.isElementAccessExpression(node.left)) checkSizeWrite(possibleValues(node.left.argumentExpression, checker), node.right, node);
    }
    // el.style.setProperty("font-size" | K, x)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setProperty" &&
      node.arguments[0]
    ) {
      checkSizeWrite(possibleValues(node.arguments[0], checker), node.arguments[1], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...findings.values()];
}

const FIXTURE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  jsx: ts.JsxEmit.Preserve,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};
let fixtureHost: ts.CompilerHost | undefined;

/** Scan one in-memory source (detector fixtures): a one-file program. */
export function scanSource(source: string, fileName: string, options: Options = {}): Finding[] {
  fixtureHost ??= ts.createCompilerHost(FIXTURE_OPTIONS);
  const base = fixtureHost;
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (name, version, ...rest) => (name === fileName ? file : base.getSourceFile(name, version, ...rest)),
    fileExists: (name) => name === fileName || base.fileExists(name),
    readFile: (name) => (name === fileName ? source : base.readFile(name)),
  };
  const program = ts.createProgram({ rootNames: [fileName], options: FIXTURE_OPTIONS, host });
  return scanProgramFile(file, program.getTypeChecker(), fileName, options);
}

/** Off-scale font sizes and @apply classes in a stylesheet. */
export function scanStylesheet(css: string, fileName: string, options: Options = {}): Finding[] {
  const findings: Finding[] = [];
  const root = postcss.parse(css, { from: fileName });
  root.walkDecls((decl) => {
    const line = decl.source?.start?.line ?? 0;
    if (decl.prop === "font-size" && isOffScaleFontSize(decl.value, options)) {
      findings.push({ file: fileName, line, what: `font-size: ${decl.value}` });
    }
    if (decl.prop === "font" && !CSS_WIDE_KEYWORDS.includes(decl.value.trim())) {
      findings.push({ file: fileName, line, what: `font: ${decl.value}` });
    }
  });
  root.walkAtRules("apply", (rule) => {
    for (const token of rule.params.split(/\s+/)) {
      const bad = offScaleTextClass(token, options);
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
      // `theme` is not declared: an unresolved size is not a token
      "x.tsx:6 fontSize theme.fontSize (unresolved)",
      "x.tsx:7 font-size: 11px",
    ]);
  });

  it("finds the size in a font shorthand", () => {
    for (const bad of ["13px Arial", "bold 12px/1.4 sans-serif", "italic 0.8rem serif", "13px / 1.4 a", "small-caption", "var(--oops) serif", "600 var(--weight) var(--text-body) sans"]) {
      expect(isOffScaleFontShorthand(bad), bad).toBe(true);
    }
    for (const ok of ["inherit", "unset !important", "600 var(--text-body)/1.4 var(--font-sans)", "italic var(--text-code) monospace", "var(--text-body) / 1.4 serif"]) {
      expect(isOffScaleFontShorthand(ok), ok).toBe(false);
    }
  });

  it("resolves constant property keys and checks inline font shorthand (T4 re-review probes)", () => {
    expect(format(scanSource(`<div style={{ font: "13px Arial" }} />`, "x.tsx"))).toEqual(['x.tsx:1 font "13px Arial"']);
    expect(format(scanSource(`const key = "fontSize" as const; <div style={{ [key]: 13 }} />`, "x.tsx"))).toEqual(["x.tsx:1 fontSize 13"]);
    expect(format(scanSource(`const key = "fontSize" as const; document.body.style[key] = "13px";`, "x.tsx"))).toEqual(['x.tsx:1 fontSize "13px"']);
  });

  it("flags off-scale CSS font sizes and off-scale @apply", () => {
    const css = `.a { font-size: calc(0.6875rem * var(--app-font-scale)); }
.b { font-size: var(--text-caption); }
.c { font-size: 0.75em; }
.d { @apply text-xs font-medium; }
.e { font: 12px/1.4 sans-serif; }`;
    expect(format(scanStylesheet(css, "x.css"))).toEqual([
      "x.css:1 font-size: calc(0.6875rem * var(--app-font-scale))",
      "x.css:3 font-size: 0.75em",
      "x.css:5 font: 12px/1.4 sans-serif",
      "x.css:4 @apply text-xs",
    ]);
  });
});

/**
 * Bypass routes (T4 review): each fixture must produce at least one finding.
 * Values the guard cannot resolve to a type token are findings too - an
 * unresolved size is an unguarded size.
 */
const BYPASS_SOURCES: Array<[string, string]> = [
  ["arbitrary length hint", `<div className="text-[length:13px]" />`],
  ["variant + length hint", `<div className="md:text-[length:var(--oops)]" />`],
  ["arbitrary em", `<div className="text-[1.1em]" />`],
  ["arbitrary percent", `<div className="text-[80%]" />`],
  ["arbitrary keyword", `<div className="text-[larger]" />`],
  ["v4 length shorthand", `<div className="text-(length:--my-size)" />`],
  ["arbitrary after modifier", `<div className="text-[13px]/6" />`],
  ["computed inline size", `<div style={{ fontSize: 6 + 7 }} />`],
  ["const inline size", `const size = 13; <div style={{ fontSize: size }} />`],
  ["number-typed inline size", `function F({ n }: { n: number }) { return <div style={{ fontSize: n }} />; }`],
  ["template px inline size", "function F({ n }: { n: number }) { return <div style={{ fontSize: `${n}px` }} />; }"],
  ["shorthand property", `const fontSize = "12px"; <div style={{ fontSize }} />`],
  ["string-typed inline size", `const theme: { size: string } = { size: "x" }; <div style={{ fontSize: theme.size }} />`],
  ["conditional with a px branch", `declare const big: boolean; <div style={{ fontSize: big ? "var(--text-body)" : "14px" }} />`],
  ["computed property name", `const s = { ["fontSize"]: 12 };`],
  ["DOM style assignment", `declare const el: { style: { fontSize: string } }; el.style.fontSize = "11px";`],
  ["setProperty", `declare const el: { style: { setProperty(a: string, b: string): void } }; el.style.setProperty("font-size", "0.8rem");`],
  ["SVG attribute", `<text fontSize="11" />`],
  ["constant concatenation", `clsx("text-" + "sm");`],
  ["const-folded concatenation", `const size = "xs"; cn("text-" + size);`],
  ["dynamic concatenation", `function f(size: string) { return "font-medium text-" + size; }`],
  ["dynamic template", "function f(size: string) { return `p-2 text-${size}`; }"],
  ["dynamic size-name prefix", "function f(s: string) { return `text-x${s}`; }"],
  ["dynamic arbitrary template", "function f(n: number) { return `text-[${n}px]`; }"],
  ["css in a string, em", `const css = "<style>p { font-size: 0.7em }</style>";`],
  // T4 re-review: font shorthand and constant (checker-resolved) property keys
  ["inline font shorthand", `<div style={{ font: "13px Arial" }} />`],
  ["const computed key in JSX style", `const key = "fontSize" as const; <div style={{ [key]: 13 }} />`],
  ["const key DOM element access", `const key = "fontSize" as const; document.body.style[key] = "13px";`],
  ["const key object element write", `const K = "fontSize"; const style: Record<string, unknown> = {}; style[K] = 13;`],
  ["const computed key object literal", `const K = "fontSize"; const s = { [K]: "13px" };`],
  ["as-const key map element access", `const keys = { size: "fontSize" } as const; document.body.style[keys.size] = "12px";`],
  ["DOM font shorthand assignment", `document.body.style.font = "bold 12px/1.4 sans-serif";`],
  ["const key font shorthand", `const F = "font"; <div style={{ [F]: "italic 0.8rem serif" }} />`],
  ["const key setProperty", `const P = "font-size"; document.body.style.setProperty(P, "11px");`],
  ["setProperty font shorthand", `document.body.style.setProperty("font", "11px serif");`],
  ["system-font shorthand", `<div style={{ font: "small-caption" }} />`],
  ["css in a string, font shorthand", `const css = "<style>p { font: 11px Arial }</style>";`],
];

const ALLOWED_SOURCES: Array<[string, string]> = [
  [
    "tokens, colours and variants",
    `<div className="text-caption md:text-list text-body/6 text-code text-title !text-list hover:text-accent [&>p]:text-list text-muted-foreground text-[#ff6a2a] text-[var(--tool-terminal)] text-[color:var(--x)] text-(--brand) text-left text-ellipsis text-[length:var(--text-body)]" />`,
  ],
  ["token variable", `<div style={{ fontSize: "var(--text-code)" }} />`],
  ["as-const token theme", `const codeTheme = { fontSize: "var(--text-code)" } as const; <div style={{ fontSize: codeTheme.fontSize }} />`],
  ["conditional tokens", `declare const big: boolean; <div style={{ fontSize: big ? "var(--text-title)" : "var(--text-body)" }} />`],
  ["token concatenation", `declare const big: boolean; cn("text-" + (big ? "title" : "body"));`],
  ["literal-union colour template", `declare const tone: "red-500" | "muted-foreground"; const c = \`text-\${tone}\`;`],
  ["dynamic text-prefixed non-size key", "function f(id: string) { return `text-editor-${id}`; }"],
  ["tailwind-merge fontSize class group", `const config = { classGroups: { fontSize: [{ text: ["caption", "list"] }] } };`],
  ["dynamic non-size class", "function f(gap: string) { return `flex gap-${gap} text-list`; }"],
  ["font shorthand keyword", `<div style={{ font: "inherit" }} />`],
  ["font shorthand with a token size", `<div style={{ font: "600 var(--text-body)/1.4 var(--font-sans)" }} />`],
  ["font shorthand with a token size, no line height", `document.body.style.font = "italic var(--text-code) monospace";`],
  ["const key token variable", `const K = "fontSize" as const; <div style={{ [K]: "var(--text-body)" }} />`],
  ["const key DOM token variable", `const K = "fontSize"; document.body.style[K] = "var(--text-caption)";`],
  ["unrelated const keys", `const K = "fontWeight"; const s = { [K]: 600 }; document.body.style[K] = "600";`],
  ["string-typed key", `function f(k: string, v: string) { const s: Record<string, string> = {}; s[k] = v; return { [k]: v }; }`],
];

describe("type scale guard: bypass routes", () => {
  it.each(BYPASS_SOURCES)("flags %s", (_name, source) => {
    expect(scanSource(source, "x.tsx").length).toBeGreaterThan(0);
  });

  it.each(ALLOWED_SOURCES)("keeps %s", (_name, source) => {
    expect(format(scanSource(source, "x.tsx"))).toEqual([]);
  });

  it.each([
    ["em", ".a { font-size: 0.7em; }"],
    ["percent", ".a { font-size: 80%; }"],
    ["unknown variable", ".a { font-size: var(--oops); }"],
    ["keyword", ".a { font-size: smaller; }"],
    ["calc of a token", ".a { font-size: calc(var(--text-body) * 0.9); }"],
    ["rem", ".a { font-size: 1rem; }"],
    ["font shorthand", ".a { font: 12px/1.4 sans-serif; }"],
    ["font shorthand keyword", ".a { font: small-caption; }"],
    ["@apply length hint", ".a { @apply text-[length:13px]; }"],
  ])("flags CSS %s", (_name, css) => {
    expect(scanStylesheet(css, "x.css").length).toBeGreaterThan(0);
  });

  it("keeps CSS token variables and CSS-wide keywords", () => {
    const css = `.a { font-size: var(--text-caption); }
.b { font-size: var(--text-code) !important; }
.c { font-size: inherit; }
.d { @apply text-list font-medium; }
.e { font: inherit; }`;
    expect(format(scanStylesheet(css, "x.css"))).toEqual([]);
  });
});

describe("type scale guard: src/", () => {
  const files = walk(SRC, (path) => /\.(ts|tsx|css)$/.test(path)).filter((path) => !isTestFile(relative(ROOT, path)));
  let program: ts.Program;

  beforeAll(() => {
    // The app's own compiler settings, so imports and `as const` resolve as in tsc.
    const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.app.json"), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    });
    if (!config) throw new Error("tsconfig.app.json not readable");
    program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  }, 120_000);

  it("scans the app sources", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("uses only the five type tokens (and analytics aliases) - no off-scale classes, inline or CSS sizes", () => {
    const checker = program.getTypeChecker();
    const findings = files.flatMap((path) => {
      const rel = relative(ROOT, path).split(sep).join("/");
      const options = { analytics: isAnalyticsNumberFile(rel), standaloneDocument: STANDALONE_DOCUMENT_FILES.includes(rel) };
      if (path.endsWith(".css")) return scanStylesheet(readFileSync(path, "utf8"), rel, options);
      const file = program.getSourceFile(path);
      if (!file) throw new Error(`${rel} is not in the tsconfig.app.json program`);
      return scanProgramFile(file, checker, rel, options);
    });
    expect(format(findings)).toEqual([]);
  }, 60_000);
});
