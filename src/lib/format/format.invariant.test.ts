/**
 * Guard: numbers, dates and durations are formatted only in `src/lib/format`.
 *
 * Outside this module no code calls `Intl.*` or `toLocale*()` (those read the
 * OS locale unless a locale is passed; `Intl.Segmenter`, which formats
 * nothing, is the exception), and no file defines its own
 * `formatNumber` / `formatDuration` / `formatCurrency` / `formatCost` /
 * `formatTokens` / `formatPercent`. One implementation each (plan D15).
 * Shares are not rounded to a percent by hand either (percent guard below).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SRC = join(ROOT, "src");
const MODULE_DIR = join(SRC, "lib", "format") + sep;

const isTest = (path: string) =>
  /\.test\.tsx?$/.test(path) || path.includes(`${sep}__tests__${sep}`) || path.includes(`${sep}test${sep}`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** App sources outside the module and tests, read once; `\r\n` as `\n` (Windows checkouts). */
let appSources: { file: string; text: string }[] | undefined;
const sources = () =>
  (appSources ??= sourceFiles(SRC)
    .filter((file) => !file.startsWith(MODULE_DIR) && !isTest(file))
    .map((file) => ({ file, text: readFileSync(file, "utf8").replace(/\r\n/g, "\n") })));

/** A repo path with `/` separators, the same on every OS. */
const repoPath = (file: string) => relative(ROOT, file).split(sep).join("/");

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/**
 * Any use of `Intl` (`Intl.X`, `Intl["X"]`, `const { X } = Intl`) and
 * `toLocale*()`: they format, and read the OS locale unless one is passed.
 * The one exception is `Intl.Segmenter`, which finds word boundaries for
 * line-break hints and formats nothing.
 */
const INTL_FORMATTING = /\bIntl\b(?!\.Segmenter\b)|\.toLocale(String|DateString|TimeString)\(/;

function findings(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const { file, text } of sources()) {
    stripComments(text)
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) out.push(`${repoPath(file)}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Percent guard
//
// A share shown to the user goes through formatPercent: whole percents, `<1%`
// and `>99%` instead of a rounded 0 or 100, the app language's percent sign.
// On the syntax tree of every app source outside the module, these
// hand-rolled forms are reported:
//   - percent arithmetic (`x * 100`, `100 * x`, `x / 100`; any parentheses,
//     any spelling of 100) inside a rounding call (`Math.round / floor / ceil
//     / trunc`, an aliased `round(…)`) or a bitwise truncation (`| 0`, `~~`);
//   - `.toFixed()` / `.toPrecision()` of percent arithmetic;
//   - any value printed right before a literal `%`, however and wherever it
//     was computed: `${x}%` in a template, `x + "%"`, `{x}%` or `{x}{"%"}` in
//     JSX, and a message whose text puts `%` right after an interpolation
//     (`"Top {{percent}}%"`, in any locale) called with a value for it. Only
//     a literal (`${100}%`) and a value that styles an element are not text:
//     inside a JSX `style`, `className` or `class` attribute, a `<style>`
//     element, or an object typed `CSSProperties` (bar widths).
// The guard reads how text is built, not where values flow, so a `%` made at
// run time (`String.fromCharCode(37)`) is beyond it.
//
// A value that really is not a share (a zoom level, a download step) is
// exempted only by this exact comment, alone on the line before the site:
//
//   // format-guard: not-a-share — <reason>
//
// It must be a real comment (text in a string, a template or JSX does not
// count), and every exemption in the app is listed in EXEMPTIONS below.
// ---------------------------------------------------------------------------

const EXEMPTION = /^\/\/ format-guard: not-a-share — (\S.*)$/;

/**
 * Every exemption in the app (`file: reason → the exempted line`, sorted). A
 * new exemption, or any edit of an exempted line, is a reviewed change here:
 * the exemption covers that known expression only.
 */
const EXEMPTIONS = [
  "src/components/MessageViewer/components/ScreenshotPreviewModal.tsx: zoom level, may exceed 100% → const zoomLabel = t(\"captureMode.preview.zoomLevel\", { percent: Math.round(zoom * 100) });",
  "src/components/SimpleUpdateModal.tsx: download progress (0-100), how far the update has got → const downloadingLabel = t('simpleUpdateModal.downloading', { progress: updater.state.downloadProgress });",
  "src/components/ui/loading.tsx: progress bar label, how far a task has got (0-100) → const label = `${Math.round(clampedProgress)}%`;",
  "src/hooks/useUpdater.ts: download progress (0-100) for the progress bar and its label → const progress = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0;",
  "src/layouts/Header/SettingDropdown/FontMenuGroup.tsx: font size setting (90-130), may exceed 100% → const scaleLabel = (scale: number) => `${scale}%`;",
];

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node;

/** A numeric literal with this value, however it is spelled (`100`, `100.0`, `1e2`). */
const isNumber = (node: ts.Expression, value: number) => {
  const inner = unwrap(node);
  return ts.isNumericLiteral(inner) && Number(inner.text) === value;
};

/** `x * 100`, `100 * x`, `x / 100`, `x *= 100`, `x /= 100`. */
function isPercentArithmetic(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.AsteriskToken:
      return isNumber(node.left, 100) || isNumber(node.right, 100);
    case ts.SyntaxKind.SlashToken:
    case ts.SyntaxKind.AsteriskEqualsToken:
    case ts.SyntaxKind.SlashEqualsToken:
      return isNumber(node.right, 100);
    default:
      return false;
  }
}

const ROUNDING = new Set(["round", "floor", "ceil", "trunc"]);
const FIXED = new Set(["toFixed", "toPrecision"]);

/** The called name: `round` for `Math.round(…)`, `round(…)` and `M["round"](…)`. */
function calledName(call: ts.CallExpression): string | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return undefined;
}

const isCallOf = (node: ts.Node, names: ReadonlySet<string>): node is ts.CallExpression =>
  ts.isCallExpression(node) && names.has(calledName(node) ?? "");

const contains = (node: ts.Node, test: (node: ts.Node) => boolean): boolean =>
  test(node) || ts.forEachChild(node, (child) => contains(child, test) || undefined) === true;

const hasPercentArithmetic = (node: ts.Node) => contains(node, isPercentArithmetic);

/** An expression that yields a percentage by hand: percent arithmetic, a rounding or a fixed call. */
const isPercentish = (node: ts.Node) =>
  contains(node, (n) => isPercentArithmetic(n) || isCallOf(n, ROUNDING) || isCallOf(n, FIXED));

/** `%`, and the full-width, small and Arabic percent signs. */
const PERCENT_SIGN = "[%％﹪٪]";
const startsWithPercentSign = (text: string) => new RegExp(`^\\s*${PERCENT_SIGN}`).test(text);
const isLonePercentSign = (text: string) => new RegExp(`^\\s*${PERCENT_SIGN}\\s*$`).test(text);

/** The literal text a `+` right operand starts with (`"%"`, `` `% ${x}` ``), else "". */
function leadingText(node: ts.Expression): string {
  const inner = unwrap(node);
  if (ts.isStringLiteralLike(inner)) return inner.text;
  if (ts.isTemplateExpression(inner)) return inner.head.text;
  return "";
}

/** A literal value (`"50"`, `50`, `-5`, a template without values): text the code wrote, not a value it printed. */
function isLiteral(node: ts.Expression): boolean {
  const inner = unwrap(node);
  if (ts.isStringLiteralLike(inner) || ts.isNumericLiteral(inner)) return true;
  return (
    ts.isPrefixUnaryExpression(inner) &&
    inner.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrap(inner.operand))
  );
}

/** The literal text right after span `i`'s value: the span's own text, else a literal next value (`${x}${"%"}`). */
function textAfterSpan(spans: readonly ts.TemplateSpan[], i: number): string {
  const own = spans[i]!.literal.text;
  if (own !== "") return own;
  const next = spans[i + 1];
  return next ? leadingText(next.expression) : "";
}

/** Blank JSX text and JSX comments (`{}` with no expression) print nothing. */
const isBlank = (child: ts.JsxChild) =>
  (ts.isJsxText(child) && child.text.trim() === "") || (ts.isJsxExpression(child) && !child.expression);

const printedChildren = (node: ts.JsxElement | ts.JsxFragment) => node.children.filter((child) => !isBlank(child));

/** The value a JSX child ends with: `{x}`, or the last thing an element holds (`<b>{x}</b>`). */
function valueAtEnd(child: ts.JsxChild): ts.Expression | undefined {
  if (ts.isJsxExpression(child)) return child.expression && !isLiteral(child.expression) ? child.expression : undefined;
  if (!ts.isJsxElement(child) && !ts.isJsxFragment(child)) return undefined;
  const printed = printedChildren(child);
  const last = printed[printed.length - 1];
  return last ? valueAtEnd(last) : undefined;
}

/** The literal text a JSX child starts with: text, `{"%"}`, or the first thing an element holds (`<small>%</small>`). */
function textAtStart(child: ts.JsxChild): string {
  if (ts.isJsxText(child)) return child.text;
  if (ts.isJsxExpression(child)) return child.expression ? leadingText(child.expression) : "";
  if (!ts.isJsxElement(child) && !ts.isJsxFragment(child)) return "";
  const first = printedChildren(child)[0];
  return first ? textAtStart(first) : "";
}

/** JSX attributes whose value styles an element and is never shown as text. */
const STYLE_ATTRIBUTES = new Set(["style", "className", "class"]);

const isCssPropertiesType = (type: ts.TypeNode | undefined) =>
  type !== undefined && /\bCSSProperties$/.test(type.getText());

/**
 * Whether `node` is part of a value that styles an element rather than text:
 * inside a JSX `style` / `className` / `class` attribute or a `<style>`
 * element, or in an object typed `CSSProperties` (`const s: CSSProperties =
 * …`, `… satisfies CSSProperties`, `… as CSSProperties`). Any other JSX
 * element on the way up ends the search: its children are text.
 */
function stylesAnElement(node: ts.Node): boolean {
  for (let n = node.parent; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isJsxAttribute(n)) return STYLE_ATTRIBUTES.has(n.name.getText());
    if (ts.isJsxElement(n)) return n.openingElement.tagName.getText() === "style";
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return false;
    if ((ts.isVariableDeclaration(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) && isCssPropertiesType(n.type)) {
      return true;
    }
  }
  return false;
}

/** Message key → the interpolations its text prints right before `%` (in any locale). */
type PercentMessages = ReadonlyMap<string, ReadonlySet<string>>;

/** `{{name}}` or `{{name, format}}`, then a percent sign. */
const INTERPOLATION_BEFORE_PERCENT = new RegExp(`\\{\\{\\s*([\\w.]+)\\s*(?:,[^}]*)?\\}\\}\\s*${PERCENT_SIGN}`, "g");
/** i18next plural forms share the key they are called with (`key_one` → `key`). */
const PLURAL_SUFFIX = /_(?:ordinal_)?(?:zero|one|two|few|many|other)$/;

function percentMessagesOf(catalogs: readonly Record<string, unknown>[]): PercentMessages {
  const out = new Map<string, Set<string>>();
  for (const catalog of catalogs) {
    for (const [key, message] of Object.entries(catalog)) {
      if (typeof message !== "string") continue;
      for (const [, name] of message.matchAll(INTERPOLATION_BEFORE_PERCENT)) {
        const base = key.replace(PLURAL_SUFFIX, "");
        out.set(base, (out.get(base) ?? new Set<string>()).add(name!));
      }
    }
  }
  return out;
}

const LOCALES = join(SRC, "i18n", "locales");
let appMessages: PercentMessages | undefined;
/** Every message of every locale (`src/i18n/locales/<language>/<namespace>.json`). */
const appPercentMessages = (): PercentMessages =>
  (appMessages ??= percentMessagesOf(
    readdirSync(LOCALES).flatMap((language) =>
      readdirSync(join(LOCALES, language))
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(join(LOCALES, language, name), "utf8")) as Record<string, unknown>),
    ),
  ));

const propertyName = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;

/** In `t("key", { name: value })` (or `i18n.t`), the values the message prints right before `%`. */
function percentMessageValues(call: ts.CallExpression, messages: PercentMessages): ts.Node[] {
  if (calledName(call) !== "t") return [];
  const [key, values] = call.arguments.map(unwrap);
  const names = key && ts.isStringLiteralLike(key) ? messages.get(key.text) : undefined;
  if (!names || !values || !ts.isObjectLiteralExpression(values)) return [];
  return values.properties.filter((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return names.has(property.name.text);
    if (!ts.isPropertyAssignment(property)) return false;
    return names.has(propertyName(property.name) ?? "") && !isLiteral(property.initializer);
  });
}

/** A literal printed where it stands: a `+` operand, a template value or a JSX child (`{"%"}`). */
function isPrintedInPlace(node: ts.Node): boolean {
  let child = node;
  let parent = node.parent;
  while (ts.isParenthesizedExpression(parent)) [child, parent] = [parent, parent.parent];
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    return op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.PlusEqualsToken;
  }
  if (ts.isTemplateSpan(parent)) return parent.expression === child;
  return ts.isJsxExpression(parent) && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent));
}

/** A literal that names something (a property key, a type) rather than being a value. */
const isNameOrType = (node: ts.Node) =>
  ts.isLiteralTypeNode(node.parent) ||
  ((ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node);

/** The nodes in `node` (not its children) that print a value right before a literal `%`. */
function printedPercentSites(node: ts.Node, messages: PercentMessages): ts.Node[] {
  if (ts.isTemplateExpression(node)) {
    if (stylesAnElement(node)) return [];
    return node.templateSpans
      .filter((span, i, spans) => startsWithPercentSign(textAfterSpan(spans, i)) && !isLiteral(span.expression))
      .map((span) => span.expression);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    const concat = op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.PlusEqualsToken;
    if (!concat || !startsWithPercentSign(leadingText(node.right)) || isLiteral(node.left)) return [];
    return stylesAnElement(node) ? [] : [node];
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "style") return [];
    const children = printedChildren(node);
    return children.flatMap((child, i) => {
      const value = valueAtEnd(child);
      const next = children[i + 1];
      return value && next && startsWithPercentSign(textAtStart(next)) ? [value] : [];
    });
  }
  // A percent sign on its own, handed over as data (`suffix="%"`, `{ unit: "%" }`,
  // `[x, "%"].join("")`), is only ever there to be printed after a value. Where
  // it sits right after one (`x + "%"`, `${x}${"%"}`, `{x}{"%"}`) the rules
  // above already decide.
  if (ts.isStringLiteralLike(node)) {
    if (!isLonePercentSign(node.text) || isNameOrType(node) || isPrintedInPlace(node)) return [];
    return stylesAnElement(node) ? [] : [node];
  }
  if (ts.isCallExpression(node)) return percentMessageValues(node, messages);
  return [];
}

/** The nodes in `node` (not its children) that are hand-rolled percents by arithmetic. */
function percentSites(node: ts.Node): ts.Node[] {
  if (isCallOf(node, ROUNDING)) return node.arguments.some(hasPercentArithmetic) ? [node] : [];
  if (isCallOf(node, FIXED)) {
    const callee = unwrap(node.expression);
    return ts.isPropertyAccessExpression(callee) && hasPercentArithmetic(callee.expression) ? [node] : [];
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.BarToken && (isNumber(node.left, 0) || isNumber(node.right, 0))) {
      return hasPercentArithmetic(node) ? [node] : [];
    }
    if (op === ts.SyntaxKind.PlusToken && startsWithPercentSign(leadingText(node.right))) {
      return isPercentish(node.left) ? [node] : [];
    }
    return [];
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken) {
    const inner = unwrap(node.operand);
    const doubled = ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.TildeToken;
    return doubled && hasPercentArithmetic(inner.operand) ? [node] : [];
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans
      .filter((span) => startsWithPercentSign(span.literal.text) && isPercentish(span.expression))
      .map((span) => span.expression);
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    return node.children.filter((child, i): child is ts.JsxExpression => {
      const next = node.children[i + 1];
      return (
        ts.isJsxExpression(child) &&
        child.expression !== undefined &&
        next !== undefined &&
        ts.isJsxText(next) &&
        startsWithPercentSign(next.text) &&
        isPercentish(child.expression)
      );
    });
  }
  return [];
}

/**
 * The node whose leading trivia holds `pos`, or undefined when `pos` lies
 * inside a token (a string, a template, JSX text): only trivia holds comments.
 */
function nodeWithTriviaAt(sf: ts.SourceFile, pos: number): ts.Node | undefined {
  let node: ts.Node = sf;
  for (;;) {
    const child = node.getChildren(sf).find((c) => c.pos <= pos && pos < c.end);
    if (!child) return undefined;
    if (pos < child.getStart(sf)) return child;
    if (child.getChildCount(sf) === 0) return undefined;
    node = child;
  }
}

/** The text of the real `//` comment that is alone on line `line` (0-based), if any. */
function standaloneComment(sf: ts.SourceFile, line: number): string | undefined {
  const starts = sf.getLineStarts();
  const lineStart = starts[line];
  if (lineStart === undefined) return undefined;
  const pos = lineStart + /^[ \t]*/.exec(sf.text.slice(lineStart))![0].length;
  if (!sf.text.startsWith("//", pos)) return undefined;
  const owner = nodeWithTriviaAt(sf, pos);
  const comment = owner && ts.getLeadingCommentRanges(sf.text, owner.pos)?.find((range) => range.pos === pos);
  return comment?.kind === ts.SyntaxKind.SingleLineCommentTrivia ? sf.text.slice(comment.pos, comment.end) : undefined;
}

interface PercentScan {
  /** Reported sites: 1-based line and its text. */
  findings: { line: number; text: string }[];
  /** Exemption comments: 1-based line, reason, the exempted next line, and whether it needed one. */
  exemptions: { line: number; reason: string; site: string; used: boolean }[];
}

function scanPercent(
  file: string,
  source: string,
  { percentMessages = appPercentMessages() }: { percentMessages?: PercentMessages } = {},
): PercentScan {
  const text = source.replace(/\r\n/g, "\n");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const flagged = new Set<number>(); // 0-based lines
  const visit = (node: ts.Node): void => {
    for (const site of [...percentSites(node), ...printedPercentSites(node, percentMessages)]) {
      flagged.add(sf.getLineAndCharacterOfPosition(site.getStart(sf)).line);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const lines = text.split("\n");
  const exemptions: PercentScan["exemptions"] = [];
  const exempted = new Set<number>();
  lines.forEach((lineText, i) => {
    if (!lineText.includes("format-guard:")) return;
    const reason = EXEMPTION.exec(standaloneComment(sf, i) ?? "")?.[1];
    if (reason === undefined) return;
    exemptions.push({ line: i + 1, reason: reason.trim(), site: (lines[i + 1] ?? "").trim(), used: flagged.has(i + 1) });
    exempted.add(i + 1);
  });
  const findings = [...flagged]
    .filter((line) => !exempted.has(line))
    .sort((a, b) => a - b)
    .map((line) => ({ line: line + 1, text: (lines[line] ?? "").trim() }));
  return { findings, exemptions };
}

let appScans: (PercentScan & { file: string })[] | undefined;
const percentScans = () =>
  (appScans ??= sources().map(({ file, text }) => ({ file: repoPath(file), ...scanPercent(file, text) })));

describe("format module invariant", () => {
  it("scans the source tree", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
    expect(sources().length).toBeGreaterThan(300);
  });

  it("has no Intl.* or toLocale*() call outside src/lib/format", () => {
    expect(findings(INTL_FORMATTING)).toEqual([]);
  });

  it("has one implementation of each number / duration formatter", () => {
    expect(
      findings(
        /\b(function|const|let)\s+format(Number|Duration\w*|Currency|Cost|Tokens|Percent|Bytes|DateCompact|TimeShort|TimeAgo|DateDivider)\s*[=(:]/,
      ),
    ).toEqual([]);
  });

  it("has no hand-rolled percent arithmetic in screens — shares go through formatPercent", () => {
    expect(percentScans().flatMap(({ file, findings }) => findings.map((f) => `${file}:${f.line}: ${f.text}`))).toEqual(
      [],
    );
  }, 30_000);

  it("lists every not-a-share exemption with the line it exempts, and each one exempts a site", () => {
    expect(
      percentScans()
        .flatMap(({ file, exemptions }) =>
          exemptions.map((e) => `${file}: ${e.reason} → ${e.site}${e.used ? "" : " (exempts nothing)"}`),
        )
        .sort(),
    ).toEqual(EXEMPTIONS);
  }, 30_000);

  it("has no hand-built day key from a UTC ISO string", () => {
    expect(findings(/toISOString\(\)\.(slice|split|substring)\(/)).toEqual([]);
  });
});

describe("Intl guard", () => {
  const flags = (code: string) => INTL_FORMATTING.test(stripComments(code));

  it("flags Intl formatting and toLocale*() however Intl is reached", () => {
    for (const code of [
      'new Intl.NumberFormat("en").format(n)',
      "Intl.DateTimeFormat().format(d)",
      "new Intl.RelativeTimeFormat(locale)",
      'Intl["NumberFormat"]',
      "const { NumberFormat } = Intl;",
      "n.toLocaleString()",
      'd.toLocaleDateString("ko")',
      "d.toLocaleTimeString()",
      'const s = new Intl.Segmenter(l); const f = new Intl.NumberFormat("en");',
    ]) {
      expect(flags(code), code).toBe(true);
    }
  });

  it("allows Intl.Segmenter: word boundaries for line breaks, it formats nothing (F4a tab labels)", () => {
    expect(flags('new Intl.Segmenter(locale, { granularity: "word" })')).toBe(false);
    expect(flags('if (typeof Intl.Segmenter !== "function") return [text];')).toBe(false);
  });
});

/** Lines (1-based) the percent guard reports for one in-memory source. */
const flaggedLines = (code: string, options: { file?: string; messages?: Record<string, string> } = {}) =>
  scanPercent(options.file ?? "Probe.tsx", code, {
    percentMessages: options.messages ? percentMessagesOf([options.messages]) : undefined,
  }).findings.map((f) => f.line);

describe("percent guard: hand-rolled percent arithmetic is found", () => {
  it("the plain form", () => {
    expect(flaggedLines("export const percent = (x: number) => Math.round(x * 100);")).toEqual([1]);
  });

  it("the parenthesised form", () => {
    expect(
      flaggedLines("export const percent = (part: number, total: number) => Math.round((part / total) * 100);"),
    ).toEqual([1]);
  });

  it("100 first, deeper nesting, other spellings of 100, and a rounding call over several lines", () => {
    expect(flaggedLines("const a = Math.round(100 * part / total);")).toEqual([1]);
    expect(flaggedLines("const a = Math.round(((a - b) / b) * 100) + 0;")).toEqual([1]);
    expect(flaggedLines("const a = Math.round(100 - (rank / total) * 100);")).toEqual([1]);
    expect(flaggedLines("const a = Math.round(x * 100.0);")).toEqual([1]);
    expect(flaggedLines("const a = Math.round(x * 1e2);")).toEqual([1]);
    expect(flaggedLines("const a = Math.round((x as number) * (100));")).toEqual([1]);
    expect(flaggedLines("const a =\n  total > 0\n    ? Math.round(\n        (done / total) * 100,\n      )\n    : 0;")).toEqual([3]);
  });

  it("floor / ceil / trunc, an aliased round and bitwise truncation", () => {
    expect(flaggedLines("const a = Math.floor(r * 100);")).toEqual([1]);
    expect(flaggedLines("const a = Math.ceil(r * 100);")).toEqual([1]);
    expect(flaggedLines("const a = Math.trunc(r * 100);")).toEqual([1]);
    expect(flaggedLines("const { round } = Math;\nconst a = round(r * 100);")).toEqual([2]);
    expect(flaggedLines("const a = (r * 100) | 0;")).toEqual([1]);
    expect(flaggedLines("const a = ~~(r * 100);")).toEqual([1]);
  });

  it("toFixed / toPrecision of percent arithmetic", () => {
    expect(flaggedLines("const a = (ratio * 100).toFixed(1);")).toEqual([1]);
    expect(flaggedLines("const a = (100 * ratio).toPrecision(2);")).toEqual([1]);
    expect(flaggedLines("const a = (bp / 100).toFixed(2);")).toEqual([1]);
  });

  it("a rounded or fixed value stitched to `%` in a template, a concatenation or JSX", () => {
    expect(flaggedLines("const a = `${ratio.toFixed(1)}%`;")).toEqual([1]);
    expect(flaggedLines("const a = `${(part / total) * 100}%`;")).toEqual([1]);
    expect(flaggedLines('const a = share.toFixed(0) + "%";')).toEqual([1]);
    expect(flaggedLines('const a = (part / total) * 100 + " %";')).toEqual([1]);
    expect(flaggedLines("const A = () => <span>{Math.round(pct)}%</span>;")).toEqual([1]);
    expect(flaggedLines("const A = () => (\n  <span>\n    {(r * 100).toFixed(0)}\n    %\n  </span>\n);")).toEqual([3]);
  });

  it("reports a line once however many rules it breaks", () => {
    expect(flaggedLines("const a = `${Math.round(r * 100)}%`;")).toEqual([1]);
  });
});

describe("percent guard: a value printed right before a literal `%` is found, however it was computed", () => {
  it("in a template", () => {
    // F3b review 7: the share is computed on another line; the template only prints it.
    expect(flaggedLines("const pct = (part / total) * 100;\nexport const A = () => <span>{`${pct}%`}</span>;")).toEqual(
      [2],
    );
    expect(flaggedLines("export const percent = (pct: number) => `${pct}%`;")).toEqual([1]);
    expect(flaggedLines("const a = `${pct} %`;")).toEqual([1]);
    expect(flaggedLines("const a = `Top ${share}% of sessions`;")).toEqual([1]);
    expect(flaggedLines('const a = `${pct}${"%"}`;')).toEqual([1]);
    expect(flaggedLines('const a = done ? `${pct}%` : "–";')).toEqual([1]);
  });

  it("in a `+` concatenation", () => {
    expect(flaggedLines('const a = pct + "%";')).toEqual([1]);
    expect(flaggedLines("const a = pct + '%';")).toEqual([1]);
    expect(flaggedLines('const a = String(pct) + " %";')).toEqual([1]);
    expect(flaggedLines('const a = `${pct}` + "%";')).toEqual([1]);
    expect(flaggedLines('const a = "Top " + pct + "%";')).toEqual([1]);
    expect(flaggedLines('const a = share.toFixed(0) + "%";')).toEqual([1]);
  });

  it("in JSX: text or a string expression after the value", () => {
    expect(flaggedLines("const A = () => <span>{pct}%</span>;")).toEqual([1]);
    expect(flaggedLines("const A = () => <span>{pct} %</span>;")).toEqual([1]);
    expect(flaggedLines("const A = () => <span>{pct}{'%'}</span>;")).toEqual([1]);
    expect(flaggedLines('const A = () => <span>{pct}{"%"}</span>;')).toEqual([1]);
    expect(flaggedLines("const A = () => <span>{pct}{`%`}</span>;")).toEqual([1]);
    expect(flaggedLines("const A = () => <>{Math.abs(trend.value)}%</>;")).toEqual([1]);
    expect(flaggedLines('const A = () => <span>{t("a", { value: x })}%</span>;')).toEqual([1]);
    expect(flaggedLines("const A = () => (\n  <span>\n    {share}\n    %\n  </span>\n);")).toEqual([3]);
    // A styled element's text is still text.
    expect(flaggedLines('const A = () => <div style={{ width: "1px" }}>{pct}%</div>;')).toEqual([1]);
  });

  it("in an attribute shown as text (title, aria-label)", () => {
    expect(flaggedLines("const A = () => <span title={`${pct}%`} />;")).toEqual([1]);
    expect(flaggedLines('const A = () => <span style={{ width: "1px" }} aria-label={pct + "%"} />;')).toEqual([1]);
  });

  it("across JSX elements: the value or the `%` inside a child element", () => {
    expect(flaggedLines("const A = () => <span>{pct}<small>%</small></span>;")).toEqual([1]);
    expect(flaggedLines("const A = () => <span>{pct}<small>% done</small></span>;")).toEqual([1]);
    expect(flaggedLines("const A = () => <p><b>{pct}</b>%</p>;")).toEqual([1]);
    expect(flaggedLines("const A = () => <p><b>{pct}</b>% done</p>;")).toEqual([1]);
    expect(flaggedLines("const A = () => (\n  <p>\n    <b>\n      {pct}\n    </b>\n    {/* note */}\n    % done\n  </p>\n);")).toEqual(
      [4],
    );
  });

  it("a lone percent sign handed over to be printed after a value", () => {
    expect(flaggedLines('const A = () => <Stat value={pct} suffix="%" />;')).toEqual([1]);
    expect(flaggedLines('const METRICS = [{ value: share, unit: "%" }];')).toEqual([1]);
    expect(flaggedLines('const a = [pct, "%"].join("");')).toEqual([1]);
    expect(flaggedLines('const a = String(pct).concat("%");')).toEqual([1]);
    expect(flaggedLines("const A = () => <><span>{pct}</span><span>%</span></>;")).toEqual([1]);
  });

  it("a full-width or Arabic percent sign", () => {
    expect(flaggedLines("const a = `${pct}％`;")).toEqual([1]);
    expect(flaggedLines("const A = () => <span>{pct}٪</span>;")).toEqual([1]);
    expect(flaggedLines('const a = pct + "﹪";')).toEqual([1]);
  });

  it("in a message that prints `%` right after an interpolated value", () => {
    const messages = { "probe.top": "Top {{percent}}%", "probe.rate": "{{ rate }} % done", "probe.wide": "{{percent}}％" };
    expect(flaggedLines('const a = t("probe.top", { percent: pct });', { messages })).toEqual([1]);
    expect(flaggedLines('const a = t("probe.top", { percent });', { messages })).toEqual([1]);
    expect(flaggedLines('const a = i18n.t("probe.rate", { rate: share * 100 });', { messages })).toEqual([1]);
    expect(flaggedLines('const a = t("probe.wide", { percent: pct });', { messages })).toEqual([1]);
    expect(flaggedLines('const a = t(\n  "probe.top",\n  {\n    percent: pct,\n  },\n);', { messages })).toEqual([4]);
    expect(flaggedLines('const A = () => <span>{t("probe.top", { percent: pct })}</span>;', { messages })).toEqual([
      1,
    ]);
  });

  it("the app's messages: every locale's `{{name}}%`, by key", () => {
    expect(percentMessagesOf([{ a: "Top {{percent}}%", b: "{{n}} files", c: "{{x, number}} % of {{y}}" }])).toEqual(
      new Map([
        ["a", new Set(["percent"])],
        ["c", new Set(["x"])],
      ]),
    );
    const app = appPercentMessages();
    expect(app.get("captureMode.preview.zoomLevel")).toEqual(new Set(["percent"]));
    expect(app.get("simpleUpdateModal.downloading")).toEqual(new Set(["progress"]));
  });
});

describe("percent guard: not hand-rolled percent", () => {
  it("shares through formatPercent, 0-100 values for widths, and other rounding", () => {
    for (const code of [
      "const a = fmt.percent(part / total);",
      "const a = fmt.percent(percentage / 100);",
      "const w = (a / b) * 100;\nconst A = () => <div style={{ width: `${w}%` }} />;",
      "const multiple = Math.round(ratio * 10) / 10;",
      "const scale = fontScalePercent / 100;",
      "const a = Math.round(x);",
      'const a = `${count} files`;\nconst b = "100%";',
    ]) {
      expect(flaggedLines(code), code).toEqual([]);
    }
  });

  it("a value that styles an element: a JSX style or className, an object typed CSSProperties", () => {
    for (const code of [
      "const A = () => <div style={{ width: `${w}%` }} />;",
      'const A = () => <div style={{ width: w + "%" }} />;',
      'const A = () => <div style={{ width: done ? `${w}%` : "0%" }} />;',
      "const A = () => (\n  <div\n    style={{\n      width: `${w}%`,\n    }}\n  />\n);",
      "const A = () => <div className={`w-[${w}%]`} />;",
      'const A = () => <div className={cn("bar", `w-[${w}%]`)} />;',
      "const s: CSSProperties = { width: `${w}%` };",
      "const s: React.CSSProperties = { left: `${x}%`, top: `${y}%` };",
      "const s = { width: `${w}%` } satisfies CSSProperties;",
      "const s = { width: `${w}%` } as React.CSSProperties;",
    ]) {
      expect(flaggedLines(code), code).toEqual([]);
    }
  });

  it("literal values, `%` before a value, and messages without a value before `%`", () => {
    const messages = { "probe.top": "Top {{percent}}%", "probe.plain": "{{count}} files" };
    for (const code of [
      "const a = `${100}%`;",
      'const a = "50" + "%";',
      "const A = () => <span>{100}%</span>;",
      "const A = () => <span>100%</span>;",
      "const A = () => <span>{fmt.percent(share)}</span>;",
      "const a = `%${x}`;",
      'const a = "%d files";',
      'const a = "50% off";',
      'type Unit = "%" | "px";',
      'const UNITS = { "%": "percent" };',
      "const A = () => <span>{size}<small>MB</small></span>;",
      "const A = () => <p><b>{count}</b> files, 100%</p>;",
      'const a = t("probe.plain", { count: n });',
      'const a = t("probe.top", { percent: 50 });',
      'const a = t("probe.unknown", { percent: pct });',
      'const a = t("probe.top", { other: pct });',
    ]) {
      expect(flaggedLines(code, { messages }), code).toEqual([]);
    }
  });
});

describe("percent guard: the only exemption is an exact standalone comment on the line before", () => {
  const SITE = "export const percent = (x: number) => Math.round(x * 100);";

  it("the exact comment exempts the next line", () => {
    expect(flaggedLines(`// format-guard: not-a-share — zoom level, may exceed 100%\n${SITE}`)).toEqual([]);
    expect(flaggedLines(`function f() {\n    // format-guard: not-a-share — a reason\n    ${SITE}\n}`)).toEqual([]);
    expect(flaggedLines(`// format-guard: not-a-share — a reason\r\n${SITE}\r\n`)).toEqual([]);
  });

  it("…and only the next line", () => {
    expect(flaggedLines(`// format-guard: not-a-share — a reason\n${SITE}\n${SITE}`)).toEqual([3]);
    expect(flaggedLines(`// format-guard: not-a-share — a reason\n\n${SITE}`)).toEqual([3]);
  });

  it("an unrelated string containing the words does not exempt", () => {
    expect(flaggedLines(`export const note = "not a share"; ${SITE}`)).toEqual([1]);
    expect(flaggedLines(`export const note = "// format-guard: not-a-share — fake";\n${SITE}`)).toEqual([2]);
  });

  it("a comment that only contains the words does not exempt", () => {
    expect(flaggedLines(`${SITE} // not a shareholder`)).toEqual([1]);
    expect(flaggedLines(`${SITE} // not a share (anything)`)).toEqual([1]);
    expect(flaggedLines(`// not a share\n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`${SITE} // format-guard: not-a-share — same line`)).toEqual([1]);
    expect(flaggedLines(`foo(); // format-guard: not-a-share — after code\n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`// see format-guard: not-a-share — not at the start\n${SITE}`)).toEqual([2]);
  });

  it("the marker needs its exact form and a reason", () => {
    expect(flaggedLines(`// format-guard: not-a-share —\n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`// format-guard: not-a-share —   \n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`// format-guard: not-a-share - hyphen, not an em dash\n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`// format-guard: not a share — words\n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`//format-guard: not-a-share — no space\n${SITE}`)).toEqual([2]);
    expect(flaggedLines(`/* format-guard: not-a-share — a block comment */\n${SITE}`)).toEqual([2]);
  });

  it("text that only looks like the comment (template, JSX text, inside a block comment) does not exempt", () => {
    expect(flaggedLines("const s = `\n// format-guard: not-a-share — fake\n${Math.round(x * 100)}%`;")).toEqual([3]);
    expect(
      flaggedLines("const A = () => (\n  <p>\n    // format-guard: not-a-share — fake\n    {Math.round(x * 100)}%\n  </p>\n);"),
    ).toEqual([4]);
    expect(flaggedLines(`/* a block\n// format-guard: not-a-share — fake */\n${SITE}`)).toEqual([3]);
    expect(flaggedLines(`/** doc\n// format-guard: not-a-share — fake */\n${SITE}`)).toEqual([3]);
  });

  it("reports the line each exemption covers, and which exempt nothing", () => {
    const { exemptions } = scanPercent(
      "Probe.tsx",
      `// format-guard: not-a-share — stale\nconst a = 1;\n// format-guard: not-a-share — used\n${SITE}`,
    );
    expect(exemptions).toEqual([
      { line: 1, reason: "stale", site: "const a = 1;", used: false },
      { line: 3, reason: "used", site: SITE, used: true },
    ]);
  });
});
