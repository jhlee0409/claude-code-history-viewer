/**
 * Icon invariants (plan T5, decision D11).
 *
 * - lucide-react is pinned to one exact version, the one installed.
 * - Every icon imported from lucide-react uses its canonical name in that
 *   version: no deprecated alias (`AlertTriangle`, `Loader2`, `*Icon`, ...)
 *   and no name the package no longer ships (`GithubIcon`).
 * - Icons render at 14, 16 or 24 px only (`src/components/icon/iconRules.ts`):
 *   - a lucide icon used directly is sized 14 or 16 by its classes
 *     (`w-3.5 h-3.5`, `w-4 h-4`, `size-*`) or a `size` of 14 / 16, and takes
 *     its 1.75 stroke from `IconProvider`; it never sets its own stroke
 *     (`strokeWidth`, `stroke-2`, `stroke-[3]`) or width / height attributes;
 *   - a 24 px icon goes through `<Icon size={24}>` (stroke 1.5);
 *   - `<Icon>` (and `<GitHubMark>`) take their size from the `size` prop,
 *     never from classes;
 *   - icons are square: a `w-*` needs the matching `h-*` under the same
 *     variant (or `size-*`);
 *   - no icon sets `width` / `height` / `strokeWidth` (or min/max sizes,
 *     `scale`, `zoom`) through an inline `style`, and a `style` the checker
 *     cannot see into (a variable typed `CSSProperties`) is a finding;
 *   - container rules that size nested svgs (`[&_svg]:size-4`) and
 *     size-only class strings in icon size tables (`iconSize*`,
 *     `SIZE_CLASSES`, `spinner`) use the allowed sizes too.
 * - App code draws no raw `<svg>`: icons come from lucide. The exceptions
 *   are listed in RAW_SVG_ALLOWED (a brand mark lucide does not ship, and
 *   data charts).
 *
 * Which tags are icons is decided by the TypeScript checker, not by name: any
 * JSX tag whose props are lucide's (`absoluteStrokeWidth` is a lucide-only
 * prop) is a lucide icon - an import, an alias, a component held in a
 * variable or an icon map (`const Glyph = ICONS[k]`, `<icons.search />`).
 * Tags named like icons (`*Icon`, `x.icon`) that are not lucide follow the
 * class rules. Class values resolve through the checker as well: constants,
 * `as const` maps, `cn(...)` arguments, conditionals, `&&`, templates. A
 * class value typed only as `string` (a `className` prop passed through) is
 * unknown; it may sit next to a literal size but never be an icon's only one.
 *
 * Scope: the tsconfig.app.json program (src/ without tests). The rendered
 * sizes (flex squeeze, CSS) are measured by the UI capture harness and by
 * `scripts/ui-capture/test/stateIcons.test.mjs`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const LUCIDE_DIR = join(ROOT, "node_modules/lucide-react");

/** Type-only exports of lucide-react that are not icons. */
const LUCIDE_TYPES = new Set(["LucideIcon", "LucideProps", "IconNode"]);
/** Non-icon runtime exports the app may use. */
const LUCIDE_RUNTIME_HELPERS = new Set(["LucideProvider"]);

/**
 * Files allowed to draw a raw `<svg>`, and why. Everything else uses lucide
 * (through `<Icon>` for 24 px).
 */
const RAW_SVG_ALLOWED: Record<string, string> = {
  "src/components/icon/GitHubMark.tsx": "brand mark (Simple Icons); lucide 1.x ships no brand icons",
  "src/components/AnalyticsDashboard/components/TokenDistributionChart.tsx": "data chart (donut), not an icon",
  "src/components/SessionBoard/ContributionGrid.tsx": "data chart (contribution grid), not an icon",
};

/**
 * The wrapper's own implementation: the one place that hands lucide a size
 * and stroke (`ICON_STROKE`) and mounts the root `LucideProvider`. A
 * `LucideProvider` anywhere else is a finding (it would change the defaults).
 */
const ICON_IMPLEMENTATION_FILE = "src/components/icon/Icon.tsx";

/** Components sized by their `size` prop only (`size: IconSize`), by declaring file. */
const SIZE_PROP_COMPONENTS: Record<string, string> = {
  "src/components/icon/Icon.tsx": "Icon",
  "src/components/icon/GitHubMark.tsx": "GitHubMark",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

const rel = (file: string) => relative(ROOT, file).split(sep).join("/");

/** Names exported by the installed lucide-react: canonical vs alias -> target. */
function lucideExports(): { canonical: Set<string>; aliases: Map<string, string> } {
  const dts = readFileSync(join(LUCIDE_DIR, "dist/lucide-react.d.ts"), "utf8");
  const match = /export \{ (AArrowDown[^}]*)\}/.exec(dts);
  if (!match?.[1]) throw new Error("could not find lucide-react's export list");
  const canonical = new Set<string>();
  const aliases = new Map<string, string>();
  for (const part of match[1].split(",")) {
    const [local, exported] = part.trim().split(/\s+as\s+/);
    if (!local) continue;
    if (!exported) canonical.add(local);
    else if (exported !== local) aliases.set(exported, local);
  }
  return { canonical, aliases };
}

interface LucideImport {
  file: string;
  /** The imported (not local) name. */
  name: string;
  typeOnly: boolean;
}

function lucideImports(sf: ts.SourceFile): LucideImport[] {
  const out: LucideImport[] = [];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith("lucide-react")) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      out.push({ file: sf.fileName, name: "<non-named import>", typeOnly: false });
      continue;
    }
    for (const element of bindings.elements) {
      out.push({
        file: sf.fileName,
        name: (element.propertyName ?? element.name).text,
        typeOnly: Boolean(clause?.isTypeOnly || element.isTypeOnly),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Value resolution (checker)
// ---------------------------------------------------------------------------

/** Stand-in for a part of a class value the checker cannot resolve. */
const UNKNOWN = "\u0000";
const MAX_ALTERNATIVES = 64;

/** The string values a type can hold; UNKNOWN for a non-literal string-like part. */
function typeStrings(type: ts.Type): string[] {
  const out: string[] = [];
  for (const member of type.isUnion() ? type.types : [type]) {
    if (member.isStringLiteral()) out.push(member.value);
    else if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.BooleanLike | ts.TypeFlags.NumberLike | ts.TypeFlags.Void | ts.TypeFlags.Never)) continue;
    else out.push(UNKNOWN);
  }
  return out;
}

/** Every number a size expression can be, or null when unresolved. */
function possibleNumbers(expr: ts.Expression, checker: ts.TypeChecker): number[] | null {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    return possibleNumbers(expr.expression, checker);
  }
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)];
  if (ts.isConditionalExpression(expr)) {
    const a = possibleNumbers(expr.whenTrue, checker);
    const b = possibleNumbers(expr.whenFalse, checker);
    return a && b ? [...a, ...b] : null;
  }
  const type = checker.getTypeAtLocation(expr);
  const out: number[] = [];
  for (const member of type.isUnion() ? type.types : [type]) {
    if (member.isNumberLiteral()) out.push(member.value);
    else if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
    else return null;
  }
  return out;
}

const CLASS_HELPERS = new Set(["cn", "clsx", "classNames", "twMerge", "cx"]);

/**
 * Every class string an expression can contribute. Class helper calls
 * (`cn`, `clsx`, ...) contribute their arguments, objects their keys, `a && b`
 * its right side; anything else resolves through the checker. Unresolved
 * parts become UNKNOWN.
 */
function classStrings(expr: ts.Expression, checker: ts.TypeChecker): string[] {
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    return classStrings(expr.expression, checker);
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isTemplateExpression(expr)) {
    let acc = [expr.head.text];
    for (const span of expr.templateSpans) {
      const parts = classStrings(span.expression, checker);
      acc = acc.flatMap((a) => (parts.length ? parts : [""]).map((p) => `${a}${p}${span.literal.text}`));
      if (acc.length > MAX_ALTERNATIVES) return [UNKNOWN];
    }
    return acc;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return classStrings(expr.right, checker);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...classStrings(expr.left, checker), ...classStrings(expr.right, checker)];
    }
    if (op === ts.SyntaxKind.PlusToken) {
      const left = classStrings(expr.left, checker);
      const right = classStrings(expr.right, checker);
      const out = left.flatMap((a) => right.map((b) => `${a}${b}`));
      return out.length > MAX_ALTERNATIVES ? [UNKNOWN] : out;
    }
  }
  if (ts.isConditionalExpression(expr)) return [...classStrings(expr.whenTrue, checker), ...classStrings(expr.whenFalse, checker)];
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && CLASS_HELPERS.has(expr.expression.text)) {
    return expr.arguments.flatMap((arg) => classStrings(arg, checker));
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((el) => (ts.isSpreadElement(el) ? classStrings(el.expression, checker) : classStrings(el, checker)));
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.flatMap((p) => {
      if (ts.isSpreadAssignment(p)) return [UNKNOWN];
      const name = p.name;
      if (!name) return [UNKNOWN];
      if (ts.isComputedPropertyName(name)) return classStrings(name.expression, checker);
      return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? [name.text] : [UNKNOWN];
    });
  }
  return typeStrings(checker.getTypeAtLocation(expr));
}

// ---------------------------------------------------------------------------
// Class tokens
// ---------------------------------------------------------------------------

/** Tailwind spacing steps of the allowed sizes: 3.5 = 14 px, 4 = 16 px. */
const DIRECT_STEPS = new Set(["3.5", "4"]);
const WRAPPER_SIZES = new Set([14, 16, 24]);
const DIRECT_SIZES = new Set([14, 16]);
const SVG_RULE = /svg[^\s"'`]*\]:(w|h|size)-([\w.[\]]+)/g;
const SVG_STROKE_RULE = /svg[^\s"'`]*\]:(stroke-(?:\d[\w.]*|\[[^\]]*\]|\([^)]*\)))/g;
const ICON_LIKE_TAG = /(^|\.)(Icon|icon|[A-Z][A-Za-z0-9]*Icon)$/;
const NOT_ICONS = new Set(["SelectPrimitive.Icon"]);

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

interface SizeToken {
  prefix: string;
  dim: "w" | "h" | "size";
  step: string;
}

interface ClassScan {
  sizes: SizeToken[];
  /** Stroke-width utilities (`stroke-2`, `stroke-[3]`, `stroke-(length:--x)`). */
  strokes: string[];
  /** A part the checker could not resolve that may carry a size. */
  unresolved: boolean;
}

/** A stroke utility that sets a width, not a colour. */
function isStrokeWidthUtility(utility: string): boolean {
  const m = /^stroke-(.+)$/.exec(utility);
  if (!m?.[1]) return false;
  const value = m[1];
  if (/^\d/.test(value)) return true;
  const arbitrary = /^\[(.*)\]$/.exec(value) ?? /^\((.*)\)$/.exec(value);
  if (!arbitrary) return false;
  const inner = (arbitrary[1] ?? "").trim();
  return /^(length|number|percentage):/.test(inner) || /^[\d.]+(px|rem|em|%)?$/.test(inner);
}

function scanClasses(values: string[]): ClassScan {
  const scan: ClassScan = { sizes: [], strokes: [], unresolved: false };
  for (const value of values) {
    for (const token of value.split(/\s+/).filter(Boolean)) {
      const cut = lastTopLevel(token, ":");
      const prefix = token.slice(0, cut + 1);
      const utility = token.slice(cut + 1).replace(/^!|!$/g, "");
      if (token.includes(UNKNOWN)) {
        // `w-${n}`, a whole unknown value, a variant over an unknown utility
        if (utility === UNKNOWN || /^(w|h|size)-/.test(utility) || /^stroke-/.test(utility)) scan.unresolved = true;
        continue;
      }
      const size = /^(w|h|size)-(.+)$/.exec(utility);
      if (size) scan.sizes.push({ prefix, dim: size[1] as SizeToken["dim"], step: size[2] ?? "" });
      else if (isStrokeWidthUtility(utility)) scan.strokes.push(token);
    }
  }
  return scan;
}

/** Steps must be allowed; under each variant prefix the icon is square. */
function sizeTokenProblems(tokens: SizeToken[], allowed: Set<string>, hint: string): string[] {
  const problems: string[] = [];
  const byPrefix = new Map<string, { w: Set<string>; h: Set<string> }>();
  for (const { prefix, dim, step } of tokens) {
    if (!allowed.has(step)) problems.push(`${prefix}${dim}-${step} ${hint}`);
    const dims = byPrefix.get(prefix) ?? { w: new Set<string>(), h: new Set<string>() };
    if (dim !== "h") dims.w.add(step);
    if (dim !== "w") dims.h.add(step);
    byPrefix.set(prefix, dims);
  }
  for (const [prefix, { w, h }] of byPrefix) {
    const ws = [...w].sort().join("|");
    const hs = [...h].sort().join("|");
    if (!ws) problems.push(`sets only ${prefix}h-${hs}; icons are square (w-N h-N or size-N)`);
    else if (!hs) problems.push(`sets only ${prefix}w-${ws}; icons are square (w-N h-N or size-N)`);
    else if (ws !== hs) problems.push(`${prefix}w-${ws} with ${prefix}h-${hs} is not square`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

/** Inline style properties that change an icon's rendered size or stroke. */
const SIZE_STYLE_KEYS = new Set([
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "inlineSize", "blockSize",
  "strokeWidth", "stroke-width", "min-width", "min-height", "max-width", "max-height", "inline-size", "block-size",
  "scale", "zoom",
]);

const ICON_TABLE_NAME = /^icon(Size|Class)\w*$|^(spinner|sparkle)$|SIZE_CLASSES/;

/** Whether a string sits under a property or variable named like an icon size table. */
function inIconSizeTable(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n && !ts.isSourceFile(n); n = n.parent) {
    if ((ts.isPropertyAssignment(n) || ts.isVariableDeclaration(n)) && ICON_TABLE_NAME.test(n.name.getText())) {
      return true;
    }
    if (ts.isFunctionLike(n) || ts.isJsxAttribute(n)) return false;
  }
  return false;
}

function attr(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name
  );
}

function attrExpression(a: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const init = a?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init;
  if (ts.isJsxExpression(init)) return init.expression;
  return undefined;
}

type TagKind = "lucide" | "sizeProp" | "iconLike" | "svg" | null;

function tagKind(node: ts.JsxOpeningLikeElement, checker: ts.TypeChecker): TagKind {
  const tag = node.tagName.getText();
  if (tag === "svg") return "svg";
  if (NOT_ICONS.has(tag) || /^[a-z][\w-]*$/.test(tag)) return null;

  let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.tagName) ? node.tagName.name : node.tagName);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  if (declaration && SIZE_PROP_COMPONENTS[rel(declaration.getSourceFile().fileName)] === symbol?.name) return "sizeProp";

  // lucide's props: `absoluteStrokeWidth` exists on lucide icons (and on
  // components typed with LucideProps) only.
  const props = checker.getContextualType(node.attributes);
  const members = props ? (props.isUnion() ? props.types : [props]) : [];
  if (members.some((t) => t.getProperty("absoluteStrokeWidth"))) return "lucide";
  return ICON_LIKE_TAG.test(tag) ? "iconLike" : null;
}

export function scanIconFile(sf: ts.SourceFile, checker: ts.TypeChecker, fileName: string): string[] {
  const problems: string[] = [];
  const at = (node: ts.Node) => `${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const rawSvgAllowed = fileName in RAW_SVG_ALLOWED;
  const isImplementation = fileName === ICON_IMPLEMENTATION_FILE;

  const checkStyle = (node: ts.JsxOpeningLikeElement, report: (m: string) => void) => {
    const style = attrExpression(attr(node, "style"));
    if (!style) return;
    const keysOfType = (type: ts.Type) => checker.getPropertiesOfType(type).map((p) => p.name).filter((n) => SIZE_STYLE_KEYS.has(n));
    if (ts.isObjectLiteralExpression(style)) {
      for (const p of style.properties) {
        if (ts.isSpreadAssignment(p)) {
          const keys = keysOfType(checker.getTypeAtLocation(p.expression));
          if (keys.length) report(`style spreads a value that may set ${keys.join(", ")}`);
          continue;
        }
        const name = p.name;
        const names = !name
          ? []
          : ts.isComputedPropertyName(name)
            ? typeStrings(checker.getTypeAtLocation(name.expression))
            : ts.isIdentifier(name) || ts.isStringLiteralLike(name)
              ? [name.text]
              : [];
        for (const n of names) {
          if (SIZE_STYLE_KEYS.has(n)) report(`sets style ${n}; size icons by class or <Icon size>`);
          else if (n === UNKNOWN) report("style has a computed key the checker cannot resolve");
        }
      }
      return;
    }
    const keys = keysOfType(checker.getTypeAtLocation(style));
    if (keys.length) report(`style ${style.getText(sf)} may set ${keys.slice(0, 3).join(", ")}; write a literal style without sizes`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const kind = tagKind(node, checker);
      const tag = node.tagName.getText(sf);
      const report = (message: string) => problems.push(`${at(node)} <${tag}> ${message}`);
      const classExpr = attrExpression(attr(node, "className"));
      const classes = scanClasses(classExpr ? classStrings(classExpr, checker) : []);
      const sizeExpr = attrExpression(attr(node, "size"));

      if (kind === "svg" && !rawSvgAllowed) {
        report("is a raw svg; use a lucide icon (or add the file to RAW_SVG_ALLOWED with a reason)");
      } else if (kind === "lucide" && !isImplementation) {
        for (const forbidden of ["width", "height", "strokeWidth", "absoluteStrokeWidth"]) {
          if (attr(node, forbidden)) report(`sets ${forbidden}; use the class size or <Icon>`);
        }
        if (sizeExpr) {
          const sizes = possibleNumbers(sizeExpr, checker);
          if (!sizes) report(`has size ${sizeExpr.getText(sf)} the checker cannot resolve; use 14 or 16`);
          for (const size of sizes ?? []) {
            if (size === 24) report("is 24 px; use <Icon size={24}> for its 1.5 stroke");
            else if (!DIRECT_SIZES.has(size)) report(`has size ${size}; use 14 or 16`);
          }
        }
        sizeTokenProblems(classes.sizes, DIRECT_STEPS, "(use 14 / 16, or <Icon size={24}>)").forEach(report);
        classes.strokes.forEach((s) => report(`sets its stroke with ${s}; strokes come from IconProvider / <Icon>`));
        if (!sizeExpr && classes.sizes.length === 0) {
          report(
            classes.unresolved
              ? "takes its size only from a class value the checker cannot resolve; give it a literal w-4 h-4 / w-3.5 h-3.5"
              : "has no size; give it w-4 h-4 (16) or w-3.5 h-3.5 (14)"
          );
        }
        checkStyle(node, report);
      } else if (kind === "sizeProp") {
        if (classes.sizes.length > 0) report("sizes by class; use its size prop");
        if (classes.unresolved) report("takes a class value the checker cannot resolve; it may size the icon");
        classes.strokes.forEach((s) => report(`sets its stroke with ${s}`));
        if (sizeExpr) {
          const sizes = possibleNumbers(sizeExpr, checker);
          for (const size of sizes ?? []) if (!WRAPPER_SIZES.has(size)) report(`has size ${size}`);
        }
        checkStyle(node, report);
      } else if (kind === "iconLike") {
        sizeTokenProblems(classes.sizes, DIRECT_STEPS, "(use 14 / 16, or <Icon size={24}>)").forEach(report);
        classes.strokes.forEach((s) => report(`sets its stroke with ${s}`));
        checkStyle(node, report);
      }
    }
    // React.createElement("svg", ...)
    if (
      !rawSvgAllowed &&
      ts.isCallExpression(node) &&
      /(^|\.)createElement$/.test(node.expression.getText(sf)) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === "svg"
    ) {
      problems.push(`${at(node)} createElement("svg") is a raw svg; use a lucide icon`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Container rules anywhere; size-only class strings in icon size tables.
  const visitStrings = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const m of node.text.matchAll(SVG_RULE)) {
        if (!DIRECT_STEPS.has(m[2] ?? "")) problems.push(`${at(node)} nested svg rule ${m[0]} (use 3.5 or 4)`);
      }
      for (const m of node.text.matchAll(SVG_STROKE_RULE)) {
        if (isStrokeWidthUtility(m[1] ?? "")) problems.push(`${at(node)} nested svg stroke rule ${m[0]}`);
      }
      const scan = scanClasses([node.text]);
      const sizeOnly =
        /^\s*(?:(?:[\w-]+:)*(?:w|h|size)-\S+\s*)+$/.test(node.text) &&
        scan.sizes.every((t) => /^\d+(\.\d+)?$/.test(t.step));
      if (sizeOnly && inIconSizeTable(node)) {
        sizeTokenProblems(scan.sizes, DIRECT_STEPS, "in an icon size table").forEach((p) =>
          problems.push(`${at(node)} "${node.text}" ${p}`)
        );
      }
    }
    ts.forEachChild(node, visitStrings);
  };
  visitStrings(sf);
  return problems;
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

function appConfig(): ts.ParsedCommandLine {
  const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.app.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!config) throw new Error("tsconfig.app.json not readable");
  return config;
}

/**
 * Scan in-memory fixtures as files under src/ (so `lucide-react`, `@/...`
 * and the wrapper resolve as in the app). One program for all of them.
 */
function scanFixtures(sources: Record<string, string>): Map<string, string[]> {
  const config = appConfig();
  const base = ts.createCompilerHost(config.options);
  const files = new Map(
    Object.entries(sources).map(([name, text], i) => {
      const path = join(SRC, "__icon_fixtures__", `f${i}.tsx`);
      return [path, { name, text, sf: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }];
    })
  );
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (path, version, ...rest) => files.get(path)?.sf ?? base.getSourceFile(path, version, ...rest),
    fileExists: (path) => files.has(path) || base.fileExists(path),
    readFile: (path) => files.get(path)?.text ?? base.readFile(path),
  };
  const program = ts.createProgram({ rootNames: [...files.keys()], options: config.options, host });
  const checker = program.getTypeChecker();
  return new Map([...files.values()].map(({ name, sf }) => [name, scanIconFile(sf, checker, "fixture.tsx")]));
}

// ---------------------------------------------------------------------------
// Fixtures: known bypasses must be found, legitimate patterns must pass.
// ---------------------------------------------------------------------------

const IMPORTS = `
import * as React from "react";
import type { CSSProperties } from "react";
import { Search, Check, LucideProvider, type LucideIcon, type LucideProps } from "lucide-react";
import { Search as Magnifier } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { GitHubMark } from "@/components/icon/GitHubMark";
import { cn } from "@/lib/utils";
`;

const BYPASSES: Record<string, string> = {
  // T5 review, finding 3 (each returned no finding before)
  "inline style size on a lucide icon": `export const A = () => <Search className="w-4 h-4" style={{ width: 48, height: 48 }} />;`,
  "inline style stroke on a lucide icon": `export const A = () => <Search className="w-4 h-4" style={{ strokeWidth: 7 }} />;`,
  "inline style size on <Icon>": `export const A = () => <Icon icon={Search} size={24} style={{ width: 48, height: 48, strokeWidth: 7 }} />;`,
  "style variable on a lucide icon": `const s: CSSProperties = { width: 48 }; export const A = () => <Search className="w-4 h-4" style={s} />;`,
  "style spread with a size": `const big = { width: 48 }; export const A = () => <Search className="w-4 h-4" style={{ ...big, color: "red" }} />;`,
  "computed const style key": `const K = "width" as const; export const A = () => <Search className="w-4 h-4" style={{ [K]: 48 }} />;`,
  "cn(variable) size class": `const bad = "w-12 h-12"; export const A = () => <Search className={cn(bad)} />;`,
  "plain variable size class": `const bad = "w-12 h-12"; export const A = () => <Search className={bad} />;`,
  "as-const map size class": `const SZ = { big: "w-12 h-12" } as const; export const A = () => <Search className={SZ.big} />;`,
  "cn conditional size class": `declare const on: boolean; export const A = () => <Search className={cn("text-red-500", on && "w-12 h-12")} />;`,
  "cn object key size class": `declare const on: boolean; export const A = () => <Search className={cn({ "w-12 h-12": on })} />;`,
  "template size class": `const n = "12"; export const A = () => <Search className={\`w-\${n} h-\${n}\`} />;`,
  "icon map, held in a variable": `const icons = { search: Search }; const Glyph = icons.search; export const A = () => <Glyph className="w-12 h-12" />;`,
  "icon map, member tag": `const icons = { search: Search }; export const A = () => <icons.search className="w-12 h-12" />;`,
  "Record<string, LucideIcon> with a size prop": `const MAP: Record<string, LucideIcon> = { s: Search }; export function A({ k }: { k: string }) { const Glyph = MAP[k] ?? Search; return <Glyph size={20} />; }`,
  "LucideIcon prop at 24 directly": `export function A({ icon: Glyph }: { icon: LucideIcon }) { return <Glyph size={24} />; }`,
  "only a width class": `export const A = () => <Search className="w-3.5" />;`,
  "only a height class": `export const A = () => <Search className="h-4" />;`,
  "only a width under a variant": `export const A = () => <Search className="w-4 h-4 md:w-3.5" />;`,
  "stroke width class": `export const A = () => <Search className="w-4 h-4 stroke-[5]" />;`,
  "stroke width step class": `export const A = () => <Search className="w-4 h-4 stroke-2" />;`,
  "stroke on <Icon> by class": `export const A = () => <Icon icon={Search} size={24} className="stroke-1" />;`,
  "raw svg icon": `export const A = () => <svg width={48} height={48} viewBox="0 0 24 24"><path d="M0 0h24" /></svg>;`,
  "raw svg via createElement": `export const A = () => React.createElement("svg", { width: 48 });`,
  "size classes on <Icon>": `export const A = () => <Icon icon={Search} className="w-12 h-12" />;`,
  "unknown class on <Icon>": `export function A({ className }: { className?: string }) { return <Icon icon={Search} className={className} />; }`,
  "size classes on <GitHubMark>": `export const A = () => <GitHubMark className="w-12 h-12" />;`,
  "lucide sized only by an unknown class": `export function A({ className }: { className: string }) { return <Search className={className} />; }`,
  "unresolved size prop": `export function A({ n }: { n: number }) { return <Search size={n} />; }`,
  "nested svg stroke rule": `export const A = () => <div className="[&_svg]:stroke-[3]"><Search className="w-4 h-4" /></div>;`,
  "a second LucideProvider with other defaults": `export const A = ({ children }: { children: React.ReactNode }) => <LucideProvider size={20} strokeWidth={3}>{children}</LucideProvider>;`,
  // still found (regression)
  "literal off-scale class": `export const A = () => <Search className="w-5 h-5" />;`,
  "direct width attr": `export const A = () => <Search width={48} height={48} />;`,
  "aliased import": `export const A = () => <Magnifier className="w-12 h-12" />;`,
  "nested svg size rule": `export const A = () => <div className="[&_svg]:size-12" />;`,
  "LucideProps-typed component": `function Glyph(props: LucideProps) { return <Search {...props} />; } export const A = () => <Glyph className="w-6 h-6" />;`,
};

const ALLOWED: Record<string, string> = {
  "literal 16 / 14 classes": `export const A = () => <><Search className="w-4 h-4" /><Check className="size-3.5 text-red-500" /></>;`,
  "size props 14 / 16": `export const A = () => <><Search size={14} /><Search size={16} /></>;`,
  "<Icon> at 24 with a colour and a literal style": `export const A = () => <Icon icon={Search} size={24} className="text-muted-foreground" style={{ color: "red" }} />;`,
  "colour style on a lucide icon": `const c = "var(--x)"; export const A = () => <Search className="w-4 h-4" style={{ color: c }} />;`,
  "cn with a size and a passed class": `export function A({ className }: { className?: string }) { return <Search className={cn("w-4 h-4", className)} />; }`,
  "conditional allowed sizes": `declare const small: boolean; export const A = () => <Search className={small ? "w-3.5 h-3.5" : "w-4 h-4"} />;`,
  "as-const allowed size map": `const SZ = { sm: "w-3.5 h-3.5", md: "w-4 h-4" } as const; declare const k: keyof typeof SZ; export const A = () => <Search className={SZ[k]} />;`,
  "icon map at 16": `const MAP: Record<string, LucideIcon> = { s: Search }; export function A({ k }: { k: string }) { const Glyph = MAP[k] ?? Search; return <Glyph className="w-4 h-4" />; }`,
  "LucideIcon prop through <Icon size={24}>": `export function A({ icon }: { icon: LucideIcon }) { return <Icon icon={icon} size={24} />; }`,
  "stroke colour classes": `export const A = () => <Search className="w-4 h-4 stroke-current stroke-red-500 stroke-[var(--accent)]" />;`,
  "variant sizes, square": `export const A = () => <Search className="w-4 h-4 md:w-3.5 md:h-3.5" />;`,
  "GitHubMark by size prop": `export const A = () => <GitHubMark size={16} className="text-foreground" />;`,
  "sizes and styles on non-icon elements": `export const A = () => <div className="w-12 h-12"><span style={{ width: 48 }} /></div>;`,
};

describe("icon guard: fixtures", () => {
  let found: Map<string, string[]>;
  beforeAll(() => {
    const sources = Object.fromEntries(
      [...Object.entries(BYPASSES), ...Object.entries(ALLOWED)].map(([name, body]) => [name, `${IMPORTS}\n${body}\n`])
    );
    found = scanFixtures(sources);
  }, 120_000);

  it.each(Object.keys(BYPASSES))("finds %s", (name) => {
    expect(found.get(name)?.length ?? 0).toBeGreaterThan(0);
  });

  it.each(Object.keys(ALLOWED))("keeps %s", (name) => {
    expect((found.get(name) ?? []).join("\n")).toBe("");
  });

  it("documents every raw svg exception with a reason", () => {
    for (const [file, reason] of Object.entries(RAW_SVG_ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(10);
      expect(sourceFiles(SRC).map(rel), file).toContain(file);
    }
  });
});

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

describe("icon invariants", () => {
  const parsed = sourceFiles(SRC).map(parse);

  it("pins lucide-react to the exact installed version", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const installed = JSON.parse(readFileSync(join(LUCIDE_DIR, "package.json"), "utf8"));
    const spec: string = pkg.dependencies["lucide-react"];
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
    expect(spec).toBe(installed.version);
  });

  it("imports lucide icons only by their canonical names", () => {
    const { canonical, aliases } = lucideExports();
    const offenders: string[] = [];
    for (const sf of parsed) {
      for (const { file, name, typeOnly } of lucideImports(sf)) {
        if (LUCIDE_TYPES.has(name) || LUCIDE_RUNTIME_HELPERS.has(name)) continue;
        if (typeOnly) continue;
        if (canonical.has(name)) continue;
        const target = aliases.get(name);
        offenders.push(
          target
            ? `${rel(file)}: ${name} is a deprecated alias of ${target}`
            : `${rel(file)}: ${name} is not exported by lucide-react`
        );
      }
    }
    expect(offenders.join("\n")).toBe("");
  });

  describe("sizes", () => {
    let program: ts.Program;
    beforeAll(() => {
      const config = appConfig();
      program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
    }, 120_000);

    it("scans the app sources", () => {
      expect(program.getRootFileNames().length).toBeGreaterThan(300);
    });

    it("renders icons at 14, 16 or 24 px only, 24 through <Icon>, no raw svg", () => {
      const checker = program.getTypeChecker();
      const problems = program
        .getRootFileNames()
        .filter((path) => /\.tsx?$/.test(path))
        .flatMap((path) => {
          const sf = program.getSourceFile(path);
          if (!sf) throw new Error(`${rel(path)} is not in the program`);
          return scanIconFile(sf, checker, rel(path));
        });
      expect(problems.join("\n")).toBe("");
    }, 60_000);
  });
});
