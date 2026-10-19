import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import postcss from "postcss";
import ts from "typescript";

/**
 * Design-token guard scanner (inner-UI plan I0b, §4.5).
 *
 * Every finding is one fingerprint:
 *
 *   `${file}|${category}|${hash(normalized snippet)}|${n}`
 *
 * where `n` numbers equal snippets of the same category inside one file.
 * Line numbers are not part of it, so edits elsewhere in a file do not churn
 * the baseline; a moved or renamed file, a new file, a different snippet
 * (same-count swap) or one more copy of a snippet are all new fingerprints.
 *
 * Fifteen categories (`CATEGORIES`). Class names are folded with the
 * TypeScript checker the same way as typography.guard.test.ts (strings,
 * templates, conditionals, constants); a colour/radius/shadow class the
 * checker cannot resolve (`bg-${tone}`, `shadow-[0_0_${r}px]`) is its own
 * category; a static palette prefix with an unresolved shade (`bg-red-${n}`)
 * is a palette finding. In a class context (`className`, `cn(…)`, a
 * `*Class` name) any token whose static start could still complete to a
 * style utility (`bg-bl${v}-500`, `shadow-s${v}`, `p-${n}`) is a dynamic
 * class (`classContext`, `DYNAMIC_ROOTS`). A generically named same-file
 * `const` / `let` is followed to its references (const c = `bg-${x}`;
 * <div className={c} />), and a computed key of an object passed to
 * `clsx` / `cn` / `classnames` / `cx` is a class (clsx({ [`bg-${x}`]: on })).
 * Stylesheets are read with postcss; custom property
 * definitions (`--x: …`) are the token layer and are not counted.
 *
 * Known limits. The guard is a ratchet, not a proof: it stops new bypasses
 * written in the forms above, not every way a class string can travel. A
 * dynamic style utility is NOT seen as a class when it reaches the class
 * list through
 *   - a return inside a nested block (if (on) { return `rounded-2${v}`; })
 *     of a class-named function (only the function body's own statements count);
 *   - reassignment (c = `bg-${v}`) of a generically named variable;
 *   - the result of a generically named function (`className={tone(v)}`);
 *   - a property of a generically named object (`className={o.c}`);
 *   - a destructured binding (const [c] = [`bg-${v}`]);
 *   - a component prop whose name is not a class name (`<Box tone={…} />`
 *     rendered as `className={p.tone}`);
 *   - an export consumed in another file (no cross-file data flow).
 * Each is pinned as NOT counted by the guard test "known limits", so a
 * scanner that learns one flips that test deliberately.
 *
 * Approved shadow / radius / easing names are read from src/index.css
 * (`appTheme()`), not listed here: a `--shadow-<role>` / `--radius-<role>`
 * token there (popover, overlay, row, control, pill, dot …) makes
 * `shadow-<role>`, `rounded-<role>`, `var(--…-<role>)` in classes, CSS and
 * inline styles allowed. Scale-step names (xs, sm, md, lg, xl, 2xl, inner …)
 * are steps, not roles: of those only radius md/lg (6/8px) are allowed.
 * Motion roles work the same way: a `--transition-duration-<role>` token
 * (fast, normal, slow) makes `duration-<role>` allowed.
 */

export const CATEGORIES = [
  "palette",
  "hexRgb",
  "arbitraryColor",
  "textOpacity",
  "borderOpacity",
  "shadow",
  "motion",
  "zIndex",
  "uppercaseTracking",
  "monoUnmarked",
  "scale",
  "decoration",
  "radius",
  "spacing",
  "dynamicClass",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Finding {
  file: string;
  line: number;
  category: Category;
  snippet: string;
}

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

/** Standalone HTML documents the app writes (own stylesheet, no app tokens). */
export const EXEMPT_FILES = ["src/services/export/htmlExporter.ts"];

export const isTestFile = (relPath: string) =>
  /\.test\.(ts|tsx)$/.test(relPath) ||
  relPath.startsWith("src/test/") ||
  relPath.includes("__snapshots__") ||
  relPath.includes("__tests__");

// ---------------------------------------------------------------------------
// Class-token detectors
// ---------------------------------------------------------------------------

const PALETTE_HUES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const COLOR_UTILITIES =
  "bg|text|border|border-[trblxyse]|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|divide|placeholder|caret|accent|shadow|inset-shadow";
const PALETTE_RE = new RegExp(`^(?:${COLOR_UTILITIES})-(?:(?:${PALETTE_HUES})-\\d{2,3}|white|black)(?:/[\\w.[\\]]+)?$`);
const ARBITRARY_COLOR_RE = new RegExp(
  `^(?:${COLOR_UTILITIES})-(?:\\[(?:color:)?(?:#[\\da-fA-F]{3,8}|(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch|color-mix)\\(.*\\)|var\\(--(?!text-)[\\w-]+\\))\\]|\\((?:color:)?--(?!text-)[\\w-]+\\))(?:/[\\w.[\\]]+)?$`,
);
/** Semantic (token) colour names the app defines (bg-muted, text-accent, …). */
const TOKEN_COLOR_RE = /^[a-z][\w-]*$/;
const TEXT_STEPS = new Set(["caption", "list", "body", "code", "title", "lg", "xl", "2xl", "xs", "sm", "base", "3xl"]);
const TEXT_NON_COLOR = new Set(["left", "right", "center", "justify", "start", "end", "ellipsis", "clip", "wrap", "nowrap", "balance", "pretty"]);

/** The utility of a class token without variants (`md:`, `hover:`, `[&>p]:`) and `!`. */
export function utilityOf(token: string): string {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if ((c === "]" || c === ")") && depth > 0) depth--;
    else if (c === ":" && depth === 0) last = i;
  }
  return token.slice(last + 1).replace(/^!|!$/g, "");
}

const variantsOf = (token: string) => token.slice(0, token.length - utilityOf(token).length);

/** Allowed motion: D9 durations (and the --ease-* tokens of the theme). */
export const ALLOWED_DURATIONS = new Set(["150", "250", "400"]);

/** Tailwind size-step names: a token named like this is a scale step, not a role. */
const SCALE_STEP = /^(?:\d*x[sl]|sm|md|lg|base|inner|none|full|DEFAULT)$/;

/** The approved token names of a theme stylesheet. */
export interface ThemeTokens {
  /** `--shadow-<role>` (popover, overlay …): `shadow-<role>` is allowed. */
  shadows: Set<string>;
  /** `--radius-<role>` (row, control, overlay, pill, dot …): `rounded-<role>` is allowed. */
  radii: Set<string>;
  /** `--ease-<name>`: `ease-<name>` is allowed. */
  eases: Set<string>;
  /** `--transition-duration-<role>` (fast, normal, slow): `duration-<role>` is allowed. */
  durations: Set<string>;
  /** `--color-<name>`: the semantic colour names (`bg-<name>`, `text-<name>/…`). */
  colors: Set<string>;
}

export function themeFromCss(css: string): ThemeTokens {
  const defined = (prefix: string) => [...css.matchAll(new RegExp(`--${prefix}-([\\w-]+)\\s*:`, "g"))].map((m) => m[1] ?? "");
  const roles = (prefix: string) => new Set(defined(prefix).filter((name) => !SCALE_STEP.test(name)));
  return { shadows: roles("shadow"), radii: roles("radius"), eases: new Set(defined("ease")), durations: roles("transition-duration"), colors: new Set(defined("color")) };
}

let cachedTheme: ThemeTokens | undefined;
/** The app's theme: src/index.css. */
export const appTheme = (): ThemeTokens => (cachedTheme ??= themeFromCss(readFileSync(join(SRC, "index.css"), "utf8")));

export interface ScanOptions {
  /** Approved token names (default: appTheme()). */
  theme?: ThemeTokens;
}

/** Radius steps on the token scale: 6 (md), 8 (lg); full (pills, dots) and none. */
const ALLOWED_RADIUS = new Set(["md", "lg", "full", "none"]);
const allowedRadius = (name: string, theme: ThemeTokens) => ALLOWED_RADIUS.has(name) || theme.radii.has(name);

/** `x-<name>`, `x-[var(--<token>-<name>)]` or `x-(--<token>-<name>)`: the token name, else null. */
function tokenReference(value: string, token: string): string | null {
  const m = new RegExp(`^(?:\\[var\\(--${token}-([\\w-]+)\\)\\]|\\(--${token}-([\\w-]+)\\))$`).exec(value);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** A CSS value that is exactly `var(--<token>-<name>)` with an approved name. */
const isTokenVar = (value: string, token: string, allowed: (name: string) => boolean) => {
  const m = new RegExp(`^var\\(--${token}-([\\w-]+)\\)$`).exec(value.trim());
  return !!m && allowed(m[1] ?? "");
};

/**
 * Layout spacing scale (plan §4.1 "배치 간격"): 4·8·12·16·24·32 px, and 0.
 * Numeric spacing utilities are n × 4px (Tailwind's --spacing 0.25rem).
 */
export const LAYOUT_SPACING_PX = new Set([0, 4, 8, 12, 16, 24, 32]);
const SPACING_UTILITY = /^-?(gap-x|gap-y|gap|space-x|space-y|px|py|pt|pr|pb|pl|ps|pe|p|mx|my|mt|mr|mb|ml|ms|me|m)-(.+)$/;

/** Is a spacing utility value off the layout scale? (`5`, `2.5`, `px`, `[7px]`; not `4`, `auto`, `[var(--x)]`) */
function offScaleSpacing(value: string): boolean {
  if (value.startsWith("[")) return !/^\[var\(--/.test(value);
  if (value.startsWith("(")) return false; // (--token)
  if (value === "px") return true;
  if (/^\d+(?:\.\d+)?$/.test(value)) return !LAYOUT_SPACING_PX.has(Number(value) * 4);
  return false; // auto, reverse, named
}

/** Literal lengths in a CSS padding/margin/gap value that are off the layout scale. */
export function offScaleLengths(value: string): string[] {
  let rest = value;
  for (let prev = ""; prev !== rest; ) {
    prev = rest;
    rest = rest.replace(/var\([^()]*\)/g, " ");
  }
  const bad: string[] = [];
  for (const m of rest.matchAll(/(?<![\w.#-])-?(\d*\.?\d+)(px|rem|em)\b/g)) {
    const n = Number(m[1]);
    const px = m[2] === "px" ? n : m[2] === "rem" ? n * 16 : NaN; // em depends on the element: never on the scale
    if (!LAYOUT_SPACING_PX.has(px)) bad.push(m[0]);
  }
  return bad;
}
const SPACING_CSS_PROP = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?|gap|row-gap|column-gap|grid-gap)$/;
const SPACING_STYLE_PROP = /^(?:(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?|gap|rowGap|columnGap)$/;

/** Categories of one class token (most tokens: none). */
export function classTokenCategories(token: string, theme: ThemeTokens = appTheme()): Category[] {
  const u = utilityOf(token);
  const out: Category[] = [];
  const shadowValue = /^shadow-(.+)$/.exec(u)?.[1];
  if (shadowValue !== undefined) {
    const name = tokenReference(shadowValue, "shadow") ?? (/^[a-z][\w-]*$/.test(shadowValue) ? shadowValue : null);
    if (name !== null && theme.shadows.has(name)) return out; // an approved elevation token
  }
  if (PALETTE_RE.test(u)) out.push("palette");
  else if (ARBITRARY_COLOR_RE.test(u)) out.push("arbitraryColor");
  else {
    const text = /^text-([a-z][\w-]*)\/[\w.[\]]+$/.exec(u);
    if (text && !TEXT_STEPS.has(text[1] ?? "") && !TEXT_NON_COLOR.has(text[1] ?? "") && TOKEN_COLOR_RE.test(text[1] ?? "")) out.push("textOpacity");
    const border = /^border(?:-[trblxyse])?-([a-z][\w-]*)\/[\w.[\]]+$/.exec(u);
    if (border && TOKEN_COLOR_RE.test(border[1] ?? "")) out.push("borderOpacity");
  }
  if (/^shadow(?:-|$)/.test(u) && u !== "shadow-none" && !/^shadow-\[?(?:color:)?(?:#|var|rgb)/.test(u) && !PALETTE_RE.test(u)) out.push("shadow");
  const duration = /^duration-(.+)$/.exec(u);
  if (duration && !ALLOWED_DURATIONS.has(duration[1] ?? "") && !theme.durations.has(duration[1] ?? "")) out.push("motion");
  const ease = /^ease-(.+)$/.exec(u);
  if (ease && !theme.eases.has(ease[1] ?? "")) out.push("motion");
  if (/^z-\[.+\]$/.test(u)) out.push("zIndex");
  if (/^scale-/.test(u) && /(^|:)(hover|active|group-hover|focus):/.test(variantsOf(token))) out.push("scale");
  if (/^backdrop-blur/.test(u) || /^bg-(gradient|linear|radial|conic)-/.test(u)) out.push("decoration");
  const radius = /^rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?(?:-(.+))?$/.exec(u);
  if (radius) {
    const size = radius[1] ?? "";
    const referenced = tokenReference(size, "radius");
    const allowed = referenced !== null ? allowedRadius(referenced, theme) : size !== "" && allowedRadius(size, theme);
    if (!allowed) out.push("radius");
  }
  const spacing = SPACING_UTILITY.exec(u);
  if (spacing && offScaleSpacing(spacing[2] ?? "")) out.push("spacing");
  return out;
}

/** Class-string level: `uppercase` + `tracking-*` together, colored icon boxes. */
export function classStringCategories(tokens: string[]): Array<{ category: Category; snippet: string }> {
  const utilities = tokens.map(utilityOf);
  const out: Array<{ category: Category; snippet: string }> = [];
  const tracking = utilities.find((u) => /^tracking-/.test(u));
  if (utilities.includes("uppercase") && tracking) out.push({ category: "uppercaseTracking", snippet: `uppercase ${tracking}` });
  // Coloured icon box: a fixed square, rounded, centred, on a tinted fill.
  const square = utilities.some((u) => /^size-(\d+|\[.+\])$/.test(u)) || (utilities.some((u) => /^w-\d+$/.test(u)) && utilities.some((u) => /^h-\d+$/.test(u)));
  const tinted = utilities.find((u) => /^bg-[a-z][\w-]*\/\d+$/.test(u) || (PALETTE_RE.test(u) && u.startsWith("bg-")));
  const centred = utilities.includes("items-center") && utilities.includes("justify-center");
  const rounded = utilities.some((u) => /^rounded/.test(u));
  if (square && tinted && centred && rounded) out.push({ category: "decoration", snippet: `icon box ${tinted}` });
  return out;
}

/** A part of a class string the checker cannot resolve. */
const UNKNOWN = "\u0000";

/**
 * Utility roots of the guarded families: colour, shadow, radius, spacing,
 * motion, z-index. `classTokenCategories` judges their values; an
 * unresolved value cannot be judged, so in a class context it is a dynamic
 * class (second review N2).
 */
export const DYNAMIC_ROOTS = [
  ...COLOR_UTILITIES.replace("border-[trblxyse]", "border").split("|"),
  "rounded",
  ...["p", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe", "m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me", "gap", "gap-x", "gap-y", "space-x", "space-y"],
  "duration",
  "ease",
  "delay",
  "z",
];

/**
 * Can a utility whose static start is `stem` (the text before the first
 * unresolved part) be one of DYNAMIC_ROOTS? Either the stem already names
 * a root and part of its value (`bg-bl`, `shadow-s`, `rounded-2`,
 * `text-editor-`), or it is the start of a root (`b`, `roun`, `p`). An
 * empty stem (`${className}`) and other utilities (`flex-`, `top-`, `w-`)
 * are not.
 */
export function couldBeStyleUtility(stem: string): boolean {
  const s = stem.replace(/^-/, ""); // negative margins: -mt-${n}
  if (s === "") return false;
  return DYNAMIC_ROOTS.some((root) => s.startsWith(`${root}-`) || `${root}-`.startsWith(s));
}
const PALETTE_PREFIX_RE = new RegExp(`^(?:${COLOR_UTILITIES})-(?:${PALETTE_HUES})-`);
const STYLE_PREFIX_RE = /^(?:bg|text|border|shadow|rounded)-?/;
const SIDE_RE = /^(?:[trblxyse]|tl|tr|br|bl|ss|se|es|ee)-$/;

/**
 * The category of a utility with an unresolved part: a static palette prefix
 * (`bg-red-${n}`) is a palette bypass; a `bg-` / `text-` / `border-` /
 * `shadow-` / `rounded-` utility whose unresolved part is its value - right
 * after the prefix, a side, an arbitrary-value bracket or a theme colour
 * (`bg-${tone}`, `shadow-[0_0_${r}px]`, `border-x-${v}`, `text-accent/${o}`) -
 * is a dynamic class. Other strings that merely start like one
 * (`text-editor-${id}`, a state key) and unresolved non-style classes
 * (`${className}`) are not counted.
 */
export function dynamicCategory(utility: string, theme: ThemeTokens = appTheme(), inClass = false): Category | null {
  const at = utility.indexOf(UNKNOWN);
  if (at < 0) return null;
  if (PALETTE_PREFIX_RE.test(utility)) return "palette";
  if (inClass && couldBeStyleUtility(utility.slice(0, at))) return "dynamicClass";
  const prefix = STYLE_PREFIX_RE.exec(utility);
  if (!prefix || (prefix[0].length < utility.length && !prefix[0].endsWith("-") && utility[prefix[0].length] !== UNKNOWN)) return null;
  const middle = utility.slice(prefix[0].length, at);
  const isValue =
    middle === "" ||
    middle.startsWith("[") ||
    middle.startsWith("(") ||
    SIDE_RE.test(middle) ||
    (/^([a-z][\w-]*?)[-/]$/.test(middle) && theme.colors.has(middle.slice(0, -1)));
  return isValue ? "dynamicClass" : null;
}

// ---------------------------------------------------------------------------
// Value-level detectors (inline styles, CSS)
// ---------------------------------------------------------------------------

const HEX_RE = /(?<![\w&#-])#(?:[\da-fA-F]{8}|[\da-fA-F]{6}|[\da-fA-F]{4}|[\da-fA-F]{3})(?![\w-])/g;
const FN_COLOR_RE = /\b(?:rgba?|hsla?)\(\s*[\d.][^)]*\)/g;

/** Hex / rgb() / hsl() colour literals in a CSS-ish value (the whole literal is the snippet). */
export function colorLiterals(value: string): string[] {
  return [...(value.match(HEX_RE) ?? []), ...(value.match(FN_COLOR_RE) ?? []).map((m) => m.replace(/\s+/g, " "))];
}

const TIME_RE = /(?<![\w-])(\d*\.?\d+)(ms|s)\b/g;
/** Literal durations (not var(--duration-*)) outside the allowed set. */
export function offTokenDurations(value: string): string[] {
  const bad: string[] = [];
  for (const m of value.matchAll(TIME_RE)) {
    const ms = m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
    if (ms === 0) continue;
    if (!ALLOWED_DURATIONS.has(String(ms))) bad.push(`${m[1]}${m[2]}`);
  }
  return bad;
}

const normalize = (snippet: string) => snippet.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// TypeScript sources
// ---------------------------------------------------------------------------

type Value = string | number;
const MAX_ALTERNATIVES = 64;

/**
 * Every value `expr` can take (unresolved parts become UNKNOWN with `partial`).
 *
 * Past MAX_ALTERNATIVES only the part that overflows folds to one UNKNOWN;
 * the static text around it (template head, literal spans) and the parts
 * before it stay resolved. Each folded part is added to `folded`, so its own
 * literals (`${on ? "rounded-2xl" : "rounded-md"}`) are scanned on their own
 * instead of through this expression.
 */
/** Type-only wrappers that never change a string's value: `(x)`, `x as T`, `x satisfies T`, `x!`, `<T>x`. */
function isTypeWrapper(node: ts.Node): node is ts.ParenthesizedExpression | ts.AsExpression | ts.SatisfiesExpression | ts.NonNullExpression | ts.TypeAssertion {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node);
}

function possibleValues(expr: ts.Expression, checker: ts.TypeChecker, partial = false, folded?: Set<ts.Node>): Value[] | null {
  const unknown = partial ? [UNKNOWN] : null;
  const valuesOf = (e: ts.Expression) => possibleValues(e, checker, partial, folded);
  /** `parts` pairs each part's values with its expression (none for static text). */
  const product = (parts: Array<[Value[] | null, ts.Expression?]>): Value[] | null => {
    let acc: Value[] = [""];
    for (const [values, node] of parts) {
      let part = values;
      if (part && acc.length * part.length > MAX_ALTERNATIVES) {
        part = unknown;
        if (part && node) folded?.add(node);
      }
      if (!part) return null;
      const next = part;
      acc = acc.flatMap((a) => next.map((b) => `${a}${b}`));
    }
    return acc;
  };
  if (isTypeWrapper(expr)) {
    return valuesOf(expr.expression);
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)];
  if (ts.isTemplateExpression(expr)) {
    return product([
      [[expr.head.text]],
      ...expr.templateSpans.flatMap((span): Array<[Value[] | null, ts.Expression?]> => [[valuesOf(span.expression) ?? unknown, span.expression], [[span.literal.text]]]),
    ]);
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return product([
      [valuesOf(expr.left) ?? unknown, expr.left],
      [valuesOf(expr.right) ?? unknown, expr.right],
    ]);
  }
  if (ts.isConditionalExpression(expr)) {
    const a = valuesOf(expr.whenTrue);
    const b = valuesOf(expr.whenFalse);
    return a && b ? [...a, ...b] : unknown;
  }
  const type = checker.getTypeAtLocation(expr);
  const literals: Value[] = [];
  for (const member of type.isUnion() ? type.types : [type]) {
    if (member.isStringLiteral() || member.isNumberLiteral()) literals.push(member.value);
    else if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
    else return unknown;
  }
  return literals.length ? literals : unknown;
}

/** Components whose content is code/paths/keys/diffs: `font-mono` on or inside them is meaningful. */
export const MONO_CONTAINERS = new Set(["Code", "PathText", "Kbd", "DiffView", "OutputBlock"]);
/** HTML elements whose content is code by definition. */
export const MONO_ELEMENTS = new Set(["code", "pre", "kbd", "samp"]);
const isMonoOwner = (tag: string) => MONO_CONTAINERS.has(tag) || MONO_ELEMENTS.has(tag);
export const MONO_MARKERS = new Set(["code", "path", "id", "kbd", "diag"]);

function jsxTagName(node: ts.JsxOpeningLikeElement): string {
  const tag = node.tagName;
  return ts.isIdentifier(tag) ? tag.text : ts.isPropertyAccessExpression(tag) ? tag.name.text : tag.getText();
}

function monoExempt(node: ts.Node): boolean {
  // The element whose className this string belongs to.
  let attr: ts.Node | undefined = node;
  while (attr && !(ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) && (attr.name.text === "className" || attr.name.text === "class"))) {
    if (ts.isSourceFile(attr) || ts.isFunctionLike(attr)) return false;
    attr = attr.parent;
  }
  if (!attr) return false;
  const opening = attr.parent?.parent;
  if (!opening || !(ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening))) return false;
  const marker = opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === "data-mono");
  if (marker && ts.isJsxAttribute(marker) && marker.initializer && ts.isStringLiteral(marker.initializer) && MONO_MARKERS.has(marker.initializer.text)) return true;
  // The element itself (`<Code className="font-mono" />`, `<pre className="font-mono">`) …
  if (isMonoOwner(jsxTagName(opening))) return true;
  // … or an ancestor element that is a mono container / code element.
  for (let n: ts.Node | undefined = opening.parent; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isJsxElement(n) && isMonoOwner(jsxTagName(n.openingElement))) return true;
  }
  return false;
}

/** Functions whose string arguments are class lists. */
export const CLASS_HELPERS = new Set(["cn", "clsx", "classnames", "classNames", "cx", "twMerge", "twJoin", "cva", "tv"]);
/** Class helpers whose object arguments map class lists (the keys) to conditions: `clsx({ [cls]: on })`. Not cva / tv (their objects are config). */
const OBJECT_KEY_HELPERS = new Set(["cn", "clsx", "classnames", "classNames", "cx"]);

const calleeName = (call: ts.CallExpression) =>
  ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";

/** Is a computed property name a key of an object passed straight to clsx / cn / classnames / cx? */
function isClassKey(name: ts.ComputedPropertyName): boolean {
  const prop = name.parent;
  if (!ts.isPropertyAssignment(prop) || prop.name !== name) return false;
  const object = prop.parent;
  const call = object.parent;
  return ts.isCallExpression(call) && call.arguments.some((arg) => arg === object) && OBJECT_KEY_HELPERS.has(calleeName(call));
}

/** Identifiers of a file by text (built once per file; used to find a variable's same-file references). */
const identifierIndex = new WeakMap<ts.SourceFile, Map<string, ts.Identifier[]>>();
function identifiersNamed(file: ts.SourceFile, text: string): ts.Identifier[] {
  let index = identifierIndex.get(file);
  if (!index) {
    const built = new Map<string, ts.Identifier[]>();
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const list = built.get(node.text);
        if (list) list.push(node);
        else built.set(node.text, [node]);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    identifierIndex.set(file, built);
    index = built;
  }
  return index.get(text) ?? [];
}

/**
 * Does a generically named `const` / `let` reach a class context through one
 * of its same-file references (const c = `bg-${x}`; <div className={c} />)?
 * References are matched by symbol, so a shadowing `c` elsewhere is not one.
 * `seen` stops alias cycles.
 */
function aliasReachesClass(decl: ts.VariableDeclaration, checker: ts.TypeChecker, seen: Set<ts.Symbol>): boolean {
  if (!ts.isIdentifier(decl.name) || !(ts.getCombinedNodeFlags(decl) & ts.NodeFlags.BlockScoped)) return false;
  const symbol = checker.getSymbolAtLocation(decl.name);
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  return identifiersNamed(decl.getSourceFile(), decl.name.text).some(
    (ref) => ref !== decl.name && checker.getSymbolAtLocation(ref) === symbol && classContext(ref, checker, seen),
  );
}
/** Attribute, variable, property and function names that hold class lists (`className`, `buttonClass`, `classes`). */
const CLASS_NAME_RE = /class(?:name|names|es)?$/i;

const nameText = (name: ts.Node | undefined): string | null =>
  name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isPrivateIdentifier(name)) ? name.text : null;

/**
 * Is a string expression used as a class list? Walks up through the
 * expressions that pass a string on unchanged (parentheses, conditional
 * branches, `&&` / `||` / `??`, `+`, templates, arrays, object values,
 * returns) to the consumer: a `className` / `class` (or `*ClassName`)
 * attribute, an argument of a class helper (`cn`, `clsx`, `cva` …), a
 * computed key of an object argument of `clsx` / `cn` / `classnames` / `cx`,
 * or a variable / property / function whose name ends in class(Name|es).
 * With a checker, a generically named `const` / `let` is followed to its
 * same-file references (`aliasReachesClass`). A string anywhere else (a
 * key, a log message, a test id) is not. Known limits: scanner header.
 */
export function classContext(node: ts.Node, checker?: ts.TypeChecker, seen: Set<ts.Symbol> = new Set()): boolean {
  let child: ts.Node = node;
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); child = parent, parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return CLASS_NAME_RE.test(nameText(parent.name) ?? "");
    if (ts.isCallExpression(parent)) {
      if (child === parent.expression) return false;
      return CLASS_HELPERS.has(calleeName(parent));
    }
    if (ts.isVariableDeclaration(parent)) {
      if (child !== parent.initializer) return false;
      if (CLASS_NAME_RE.test(nameText(parent.name) ?? "")) return true;
      return !!checker && aliasReachesClass(parent, checker, seen);
    }
    if (ts.isComputedPropertyName(parent)) return isClassKey(parent);
    if (ts.isPropertyAssignment(parent)) {
      if (child !== parent.initializer) return false;
      if (CLASS_NAME_RE.test(nameText(parent.name) ?? "")) return true;
      continue; // an object value: its consumer decides (`cva(…, { variants: … })`)
    }
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsToken) return child === parent.right && CLASS_NAME_RE.test(ts.isPropertyAccessExpression(parent.left) ? parent.left.name.text : nameText(parent.left) ?? "");
      if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(op)) continue;
      return false;
    }
    if (ts.isConditionalExpression(parent)) {
      if (child === parent.condition) return false;
      continue;
    }
    if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) {
      if (ts.isArrowFunction(parent) && child !== parent.body && !ts.isBlock(child)) return false;
      if (!ts.isArrowFunction(parent) && !ts.isBlock(child)) return false; // a parameter default
      const own = ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isFunctionExpression(parent) ? nameText(parent.name) : null;
      if (own !== null) return CLASS_NAME_RE.test(own);
      continue; // an anonymous function: named by its variable / property
    }
    if (ts.isReturnStatement(parent) || ts.isBlock(parent)) {
      if (ts.isBlock(parent) && !ts.isFunctionLike(parent.parent)) return false; // a nested block statement
      continue;
    }
    if (
      isTypeWrapper(parent) ||
      ts.isJsxExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isObjectLiteralExpression(parent)
    ) {
      continue;
    }
    return false;
  }
  return false;
}

/** Findings of one TS(X) file of a program. */
export function scanProgramFile(file: ts.SourceFile, checker: ts.TypeChecker, fileName: string, theme: ThemeTokens = appTheme()): Finding[] {
  const findings: Finding[] = [];
  /** Parts of templates / `+` chains folded to UNKNOWN past MAX_ALTERNATIVES: scanned on their own. */
  const folded = new Set<ts.Node>();
  const report = (node: ts.Node, category: Category, snippet: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ file: fileName, line, category, snippet: normalize(snippet) });
  };

  const checkClassText = (text: string, node: ts.Node) => {
    const tokens = text.split(/[\s"'`{}]+/).filter(Boolean);
    const seen = new Set<string>();
    let inClass: boolean | undefined;
    for (const raw of tokens) {
      let token = raw;
      if (raw.includes(UNKNOWN)) {
        const utility = utilityOf(raw);
        inClass ??= classContext(node, checker);
        const dynamic = dynamicCategory(utility, theme, inClass);
        if (dynamic) report(node, dynamic, raw.replaceAll(UNKNOWN, "${…}"));
        if (utility.includes(UNKNOWN)) continue;
        token = utility; // only a variant is unresolved (`${v}:bg-red-500`): the utility still counts
      }
      for (const category of classTokenCategories(token, theme)) {
        const key = `${category}:${token}`;
        if (seen.has(key)) continue; // a token repeated in one string is one finding
        seen.add(key);
        report(node, category, token);
      }
      if (utilityOf(token) === "font-mono" && !monoExempt(node)) report(node, "monoUnmarked", token);
    }
    for (const { category, snippet } of classStringCategories(tokens.filter((t) => !t.includes(UNKNOWN)))) report(node, category, snippet);
    // Colour literals outside class tokens (constants, style strings, SVG attributes).
    const arbitrary = new Set(tokens.filter((t) => ARBITRARY_COLOR_RE.test(utilityOf(t)) || /\[(?:#|rgb|hsl)/.test(t)));
    const rest = tokens.filter((t) => !arbitrary.has(t)).join(" ");
    for (const literal of colorLiterals(rest)) report(node, "hexRgb", literal);
    // CSS written inside a string.
    for (const m of text.matchAll(/(?<![\w-])box-shadow\s*:\s*([^;"'`}]+)/g)) {
      const v = (m[1] ?? "").trim();
      if (v !== "none" && !isTokenVar(v, "shadow", (n) => theme.shadows.has(n))) report(node, "shadow", `box-shadow: ${v}`);
    }
    for (const m of text.matchAll(/(?<![\w-])(?<!repeating-)(linear|radial|conic)-gradient\(/g)) report(node, "decoration", `${m[1]}-gradient(…)`);
  };

  const isPartOfLargerString = (node: ts.Node): boolean => {
    if (folded.has(node)) return false; // its enclosing string folded it to UNKNOWN
    const parent = node.parent;
    return (
      (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
      ts.isTemplateSpan(parent) ||
      (isTypeWrapper(parent) && isPartOfLargerString(parent))
    );
  };

  const propName = (name: ts.PropertyName): string | null =>
    ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;

  /** Inline style values: `{ boxShadow: "…", transition: "…", borderRadius: 12, zIndex: … }`. */
  const checkStyleProperty = (name: string, value: ts.Expression, node: ts.Node) => {
    const values = possibleValues(value, checker);
    const shown = values ?? [value.getText(file)];
    for (const v of shown) {
      const s = String(v);
      if (name === "boxShadow" && s !== "none" && !isTokenVar(s, "shadow", (n) => theme.shadows.has(n))) report(node, "shadow", `boxShadow: ${s}`);
      if (/^(transition|transitionDuration|animation|animationDuration)$/.test(name)) {
        for (const d of offTokenDurations(s)) report(node, "motion", `${name}: ${d}`);
      }
      if (name === "borderRadius" && !isTokenVar(s, "radius", (n) => allowedRadius(n, theme)) && s !== "0" && s !== "inherit") report(node, "radius", `borderRadius: ${s}`);
      if (SPACING_STYLE_PROP.test(name)) {
        const off = typeof v === "number" ? (LAYOUT_SPACING_PX.has(Math.abs(v)) ? [] : [`${v}`]) : offScaleLengths(s);
        if (off.length) report(node, "spacing", `${name}: ${s}`);
      }
      if (name === "backdropFilter" || ((name === "background" || name === "backgroundImage") && /gradient\(/.test(s) && !/repeating-/.test(s))) {
        report(node, "decoration", `${name}: ${s.replace(/\(.*$/, "(…)")}`);
      }
    }
  };

  /** A literal folded into an enclosing template / `+` chain (scanned there, not twice). */
  const isInsideFoldedString = (node: ts.Node): boolean => {
    let child: ts.Node = node;
    let parent = node.parent;
    while (
      parent &&
      (isTypeWrapper(parent) ||
        (ts.isConditionalExpression(parent) && child !== parent.condition) ||
        (ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)))
    ) {
      child = parent;
      parent = parent.parent;
    }
    if (!parent || !(ts.isTemplateSpan(parent) || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken))) return false;
    // Only the operand handed to the enclosing string's product can be folded; when the
    // enclosing `+` / template was folded itself, it is scanned on its own and covers this literal.
    return !folded.has(child);
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Import specifiers and type-only positions are never style text.
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent) && !isInsideFoldedString(node)) checkClassText(node.text, node);
    } else if ((ts.isTemplateExpression(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)) && !isPartOfLargerString(node)) {
      const values = possibleValues(node, checker, true, folded) ?? [UNKNOWN];
      const strings = values.filter((v): v is string => typeof v === "string");
      // Fold alternatives: report each distinct finding once per expression.
      const before = findings.length;
      for (const v of strings) checkClassText(v, node);
      const added = findings.splice(before);
      const unique = new Map(added.map((f) => [`${f.category}|${f.snippet}`, f]));
      findings.push(...unique.values());
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      if (name && (/^(boxShadow|transition|transitionDuration|animation|animationDuration|borderRadius|backdropFilter|background|backgroundImage)$/.test(name) || SPACING_STYLE_PROP.test(name))) checkStyleProperty(name, node.initializer, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

// ---------------------------------------------------------------------------
// Stylesheets
// ---------------------------------------------------------------------------

export function scanStylesheet(css: string, fileName: string, { theme = appTheme() }: ScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const root = postcss.parse(css, { from: fileName });
  const push = (node: postcss.Node, category: Category, snippet: string) =>
    findings.push({ file: fileName, line: node.source?.start?.line ?? 0, category, snippet: normalize(snippet) });
  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--")) return; // the token layer itself
    const value = decl.value;
    for (const literal of colorLiterals(value)) push(decl, "hexRgb", `${decl.prop}: ${literal}`);
    if (decl.prop === "box-shadow" && value.trim() !== "none" && !isTokenVar(value, "shadow", (n) => theme.shadows.has(n))) push(decl, "shadow", `box-shadow: ${value}`);
    if (/^(transition|transition-duration|animation|animation-duration)$/.test(decl.prop)) {
      for (const d of offTokenDurations(value)) push(decl, "motion", `${decl.prop}: ${d}`);
    }
    if (decl.prop === "z-index" && /^-?\d+$/.test(value.trim()) && Number(value) > 1) push(decl, "zIndex", `z-index: ${value}`);
    if (/^border(-[a-z]+)*-radius$/.test(decl.prop)) {
      const v = value.trim().replace(/\s*!important$/, "");
      if (!(v === "0" || v === "inherit" || v === "var(--radius)" || isTokenVar(v, "radius", (n) => allowedRadius(n, theme)))) push(decl, "radius", `${decl.prop}: ${value}`);
    }
    if (SPACING_CSS_PROP.test(decl.prop) && offScaleLengths(value).length) push(decl, "spacing", `${decl.prop}: ${value}`);
    if (/(?<!repeating-)(linear|radial|conic)-gradient\(/.test(value)) push(decl, "decoration", `${decl.prop}: gradient`);
    if (/^(-webkit-)?backdrop-filter$/.test(decl.prop) && value.trim() !== "none") push(decl, "decoration", `${decl.prop}: ${value}`);
  });
  root.walkAtRules("apply", (rule) => {
    const tokens = rule.params.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      for (const category of classTokenCategories(token, theme)) push(rule, category, `@apply ${token}`);
    }
    for (const { category, snippet } of classStringCategories(tokens)) push(rule, category, `@apply ${snippet}`);
  });
  return findings;
}

// ---------------------------------------------------------------------------
// In-memory sources (detector fixtures)
// ---------------------------------------------------------------------------

const FIXTURE_OPTIONS: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], jsx: ts.JsxEmit.Preserve, strict: true, noEmit: true, skipLibCheck: true };
let fixtureHost: ts.CompilerHost | undefined;
/** Parsed lib / declaration files shared by every fixture program (they never change). */
const fixtureLibFiles = new Map<string, ts.SourceFile | undefined>();
let libParses = 0;
/** How many lib files the fixture host has parsed (each once; the guard test checks it). */
export const fixtureLibParses = () => libParses;

function sharedFixtureHost(): ts.CompilerHost {
  if (fixtureHost) return fixtureHost;
  const base = ts.createCompilerHost(FIXTURE_OPTIONS);
  fixtureHost = {
    ...base,
    getSourceFile: (name, version, ...rest) => {
      if (!fixtureLibFiles.has(name)) {
        libParses++;
        fixtureLibFiles.set(name, base.getSourceFile(name, version, ...rest));
      }
      return fixtureLibFiles.get(name);
    },
  };
  return fixtureHost;
}

/**
 * Scan an in-memory source as its own program. The lib files are parsed
 * once and reused (a TypeScript SourceFile is immutable and binds once),
 * so a fixture scan costs the fixture, not lib.dom.d.ts.
 */
export function scanSource(source: string, fileName: string, { theme = appTheme() }: ScanOptions = {}): Finding[] {
  const base = sharedFixtureHost();
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (name, version, ...rest) => (name === fileName ? file : base.getSourceFile(name, version, ...rest)),
    fileExists: (name) => name === fileName || base.fileExists(name),
    readFile: (name) => (name === fileName ? source : base.readFile(name)),
  };
  const program = ts.createProgram({ rootNames: [fileName], options: FIXTURE_OPTIONS, host });
  return scanProgramFile(file, program.getTypeChecker(), fileName, theme);
}

// ---------------------------------------------------------------------------
// Fingerprints and the exact-baseline ratchet
// ---------------------------------------------------------------------------

export const hashSnippet = (category: Category, snippet: string) =>
  createHash("sha256").update(`${category}\0${snippet}`).digest("hex").slice(0, 12);

/** One fingerprint per finding: (file, category, snippet hash, ordinal of that snippet in the file). */
export function fingerprints(findings: Finding[]): { list: string[]; snippets: Record<string, string> } {
  const ordinal = new Map<string, number>();
  const snippets: Record<string, string> = {};
  const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.category.localeCompare(b.category) || a.snippet.localeCompare(b.snippet));
  const list = sorted.map((f) => {
    const hash = hashSnippet(f.category, f.snippet);
    snippets[hash] = f.snippet;
    const key = `${f.file}|${f.category}|${hash}`;
    const n = (ordinal.get(key) ?? 0) + 1;
    ordinal.set(key, n);
    return `${key}|${n}`;
  });
  return { list: list.sort(), snippets };
}

export interface Baseline {
  version: 1;
  /** Count per category (for review; the list is what is enforced). */
  counts: Record<string, number>;
  fingerprints: string[];
  /** hash → snippet, for reading the baseline. */
  snippets: Record<string, string>;
}

export interface ExceptionBatch {
  task: string;
  reason: string;
  fingerprints: string[];
}
export interface Exceptions {
  version: 1;
  batches: ExceptionBatch[];
}

export type Mode = "check" | "prune" | "accept";

export interface RatchetResult {
  ok: boolean;
  added: string[];
  stale: string[];
  /** Fingerprints `accept` would take without an exception record. */
  unexplained: string[];
  messages: string[];
  baseline?: Baseline;
  exceptions?: Exceptions;
}

export const countsOf = (list: string[]) => {
  const counts: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const fp of list) {
    const category = fp.split("|")[1] ?? "";
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
};

/**
 * Reads a baseline/exceptions JSON file; `fallback` only when the file does
 * not exist yet. Any other failure (conflict markers, a truncated write) is
 * rethrown with the path: treating it as empty would let a prune run rewrite
 * the exception records away.
 */
export function readJsonOr<T>(file: string, fallback: T): T {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${file}: invalid JSON (${(error as Error).message})`, { cause: error });
  }
}

/**
 * The rule: measured fingerprints == baseline fingerprints.
 * - check:  any new or stale fingerprint fails.
 * - prune:  drops stale fingerprints (and their exception records); refuses new ones.
 * - accept: takes new fingerprints only when each has an exception record
 *           (reason + task); also drops stale ones (file moves = stale + new).
 */
export function ratchet({
  measured,
  snippets,
  baseline,
  exceptions,
  mode,
}: {
  measured: string[];
  snippets: Record<string, string>;
  baseline: Baseline;
  exceptions: Exceptions;
  mode: Mode;
}): RatchetResult {
  const have = new Set(baseline.fingerprints);
  const now = new Set(measured);
  const added = measured.filter((fp) => !have.has(fp));
  const stale = baseline.fingerprints.filter((fp) => !now.has(fp));
  const explained = new Set(exceptions.batches.flatMap((b) => b.fingerprints));
  const unexplained = added.filter((fp) => !explained.has(fp));
  const messages: string[] = [];
  const show = (fp: string) => `${fp}  ${snippets[fp.split("|")[2] ?? ""] ?? baseline.snippets[fp.split("|")[2] ?? ""] ?? ""}`;
  const build = (list: string[]): Baseline => ({
    version: 1,
    counts: countsOf(list),
    fingerprints: [...list].sort(),
    snippets: Object.fromEntries(Object.entries({ ...baseline.snippets, ...snippets }).filter(([hash]) => list.some((fp) => fp.split("|")[2] === hash)).sort(([a], [b]) => a.localeCompare(b))),
  });
  const prunedExceptions = (keep: Set<string>): Exceptions => ({
    version: 1,
    batches: exceptions.batches.map((b) => ({ ...b, fingerprints: b.fingerprints.filter((fp) => keep.has(fp)) })).filter((b) => b.fingerprints.length > 0),
  });

  if (mode === "check") {
    if (added.length) messages.push(`${added.length} new design-token bypass(es) - use a token instead, or record an exception (reason + task) and run UPDATE_TOKEN_BASELINE=accept:\n${added.map(show).join("\n")}`);
    if (stale.length) messages.push(`${stale.length} fixed bypass(es) still in the baseline - run UPDATE_TOKEN_BASELINE=prune:\n${stale.map(show).join("\n")}`);
    return { ok: added.length === 0 && stale.length === 0, added, stale, unexplained, messages };
  }
  if (mode === "prune") {
    if (added.length) {
      messages.push(`prune refuses: ${added.length} new fingerprint(s) are not in the baseline:\n${added.map(show).join("\n")}`);
      return { ok: false, added, stale, unexplained, messages };
    }
    const list = baseline.fingerprints.filter((fp) => now.has(fp));
    return { ok: true, added, stale, unexplained, messages, baseline: build(list), exceptions: prunedExceptions(new Set(list)) };
  }
  if (unexplained.length) {
    messages.push(`accept refuses: ${unexplained.length} new fingerprint(s) have no exception record (reason + task) in designTokens.exceptions.json:\n${unexplained.map(show).join("\n")}`);
    return { ok: false, added, stale, unexplained, messages };
  }
  return { ok: true, added, stale, unexplained, messages, baseline: build(measured), exceptions: prunedExceptions(now) };
}

// ---------------------------------------------------------------------------
// The app sources
// ---------------------------------------------------------------------------

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

/** Scan every app source under src/ (tests and EXEMPT_FILES excluded). */
export function scanApp(): { files: number; findings: Finding[] } {
  const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.app.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!config) throw new Error("tsconfig.app.json not readable");
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const checker = program.getTypeChecker();
  const files = walk(SRC, (path) => /\.(ts|tsx|css)$/.test(path))
    .map((path) => ({ path, rel: relative(ROOT, path).split(sep).join("/") }))
    .filter(({ rel }) => !isTestFile(rel) && !EXEMPT_FILES.includes(rel));
  const findings = files.flatMap(({ path, rel }) => {
    if (path.endsWith(".css")) return scanStylesheet(readFileSync(path, "utf8"), rel);
    const file = program.getSourceFile(path);
    if (!file) throw new Error(`${rel} is not in the tsconfig.app.json program`);
    return scanProgramFile(file, checker, rel);
  });
  return { files: files.length, findings };
}
