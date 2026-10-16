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
 *     its 1.75 stroke from `IconProvider`; it never sets its own stroke or
 *     width / height attributes;
 *   - a 24 px icon goes through `<Icon size={24}>` (stroke 1.5);
 *   - `<Icon>` takes its size from the `size` prop, never from classes;
 *   - a component held in a variable (`<Icon />` from a config table,
 *     `<StatusIcon />`) obeys the same class rule;
 *   - container rules that size nested svgs (`[&_svg]:size-4`) and
 *     size-only class strings in icon files (`"w-4 h-4"` tokens such as
 *     `layout.iconSize`) use the allowed sizes too.
 *
 * The check is static: a class held in a variable is only checked where the
 * variable is defined (the size-only string rule). The UI capture harness
 * measures the rendered sizes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const LUCIDE_DIR = join(ROOT, "node_modules/lucide-react");

/** Type-only exports of lucide-react that are not icons. */
const LUCIDE_TYPES = new Set(["LucideIcon", "LucideProps", "IconNode"]);
/** Non-icon runtime exports the app may use. */
const LUCIDE_RUNTIME_HELPERS = new Set(["LucideProvider"]);

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
// Size rules
// ---------------------------------------------------------------------------

/** Tailwind spacing steps of the allowed sizes: 3.5 = 14 px, 4 = 16 px, 6 = 24 px. */
const DIRECT_STEPS = new Set(["3.5", "4"]);
const WRAPPER_SIZES = new Set(["14", "16", "24"]);
const DIRECT_SIZES = new Set(["14", "16"]);
/** w-*, h-*, size-* with any variant prefix (md:, group-hover:, ...). */
const SIZE_TOKEN = /(?:^|\s)((?:[\w\-[\]&>*()='".]+:)*)(w|h|size)-(\S+)/g;
const SVG_RULE = /svg[^\s"'`]*\]:(w|h|size)-([\w.[\]]+)/g;
const ICON_LIKE_TAG = /(^|\.)(Icon|icon|[A-Z][A-Za-z0-9]*Icon)$/;
const NOT_ICONS = new Set(["SelectPrimitive.Icon"]);
const WRAPPER_MODULE = /(^|\/)components\/icon\/Icon$|^\.\/Icon$/;

interface SizeToken {
  prefix: string;
  dim: string;
  step: string;
}

function sizeTokens(text: string): SizeToken[] {
  return [...text.matchAll(SIZE_TOKEN)].map((m) => ({
    prefix: m[1] ?? "",
    dim: m[2] ?? "",
    step: m[3] ?? "",
  }));
}

/** The literal class fragments of a className value, and whether any part is dynamic. */
function classFragments(init: ts.JsxAttributeValue): { texts: string[]; dynamic: boolean } {
  const texts: string[] = [];
  let dynamic = false;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
      node.templateSpans.forEach((span) => visit(span.expression));
    } else if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      // `cn` and friends are calls, so only value references land here.
      dynamic = true;
    } else {
      ts.forEachChild(node, visit);
    }
  };
  if (ts.isStringLiteral(init)) texts.push(init.text);
  else if (ts.isJsxExpression(init) && init.expression) {
    // A call's callee (`cn`) is an identifier too; visit its arguments only.
    const expr = init.expression;
    if (ts.isCallExpression(expr)) expr.arguments.forEach(visit);
    else visit(expr);
  }
  return { texts, dynamic };
}

function attr(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name
  );
}

/** A numeric literal attribute value (`size={16}`), or null when not a literal. */
function numericAttr(a: ts.JsxAttribute): string | null {
  const init = a.initializer;
  if (init && ts.isJsxExpression(init) && init.expression && ts.isNumericLiteral(init.expression)) {
    return init.expression.text;
  }
  return null;
}

function localNames(sf: ts.SourceFile): { lucide: Set<string>; wrapper: Set<string> } {
  const lucide = new Set<string>();
  const wrapper = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.isTypeOnly) continue;
    const from = statement.moduleSpecifier.text;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (from === "lucide-react" && !LUCIDE_RUNTIME_HELPERS.has(imported)) lucide.add(element.name.text);
      if (WRAPPER_MODULE.test(from) && imported === "Icon") wrapper.add(element.name.text);
    }
  }
  return { lucide, wrapper };
}

/** Steps must be allowed, and w / h under the same prefix must match. */
function tokenProblems(tokens: SizeToken[], allowed: Set<string>, hint: string): string[] {
  const problems: string[] = [];
  const byPrefix = new Map<string, Map<string, string>>();
  for (const { prefix, dim, step } of tokens) {
    if (!allowed.has(step)) problems.push(`${prefix}${dim}-${step} ${hint}`);
    const dims = byPrefix.get(prefix) ?? new Map<string, string>();
    dims.set(dim, step);
    byPrefix.set(prefix, dims);
  }
  for (const [prefix, dims] of byPrefix) {
    const w = dims.get("w");
    const h = dims.get("h");
    if (w && h && w !== h) problems.push(`${prefix}w-${w} with ${prefix}h-${h} is not square`);
  }
  return problems;
}

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

function iconSizeProblems(sf: ts.SourceFile): string[] {
  const { lucide, wrapper } = localNames(sf);
  const problems: string[] = [];
  const at = (node: ts.Node) => `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      const className = attr(node, "className");
      const fragments = className?.initializer ? classFragments(className.initializer) : { texts: [], dynamic: false };
      const tokens = fragments.texts.flatMap(sizeTokens);
      const sizeAttr = attr(node, "size");
      const report = (message: string) => problems.push(`${at(node)} <${tag}> ${message}`);

      if (lucide.has(tag)) {
        for (const forbidden of ["width", "height", "strokeWidth", "absoluteStrokeWidth"]) {
          if (attr(node, forbidden)) report(`sets ${forbidden}; use the class size or <Icon>`);
        }
        if (sizeAttr) {
          const size = numericAttr(sizeAttr);
          if (size === "24") report("is 24 px; use <Icon size={24}> for its 1.5 stroke");
          else if (!size || !DIRECT_SIZES.has(size)) report(`has size ${sizeAttr.initializer?.getText()}; use 14 or 16`);
        }
        tokenProblems(tokens, DIRECT_STEPS, "(use 14 / 16, or <Icon size={24}>)").forEach(report);
        if (!sizeAttr && tokens.length === 0 && !fragments.dynamic) report("has no size; give it w-4 h-4 (16) or w-3.5 h-3.5 (14)");
      } else if (wrapper.has(tag)) {
        if (tokens.length > 0) report("sizes <Icon> by class; use its size prop");
        // A non-literal size is held to 14 | 16 | 24 by the IconSize type.
        const size = sizeAttr ? numericAttr(sizeAttr) : null;
        if (size && !WRAPPER_SIZES.has(size)) report(`has size ${size}`);
      } else if (ICON_LIKE_TAG.test(tag) && !NOT_ICONS.has(tag)) {
        tokenProblems(tokens, DIRECT_STEPS, "(use 14 / 16, or <Icon size={24}>)").forEach(report);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Container rules anywhere; size-only class strings in icon size tables
  // (a property or variable named like `iconSize`, `SIZE_CLASSES`, `spinner`).
  const visitStrings = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const m of node.text.matchAll(SVG_RULE)) {
        if (!DIRECT_STEPS.has(m[2] ?? "")) problems.push(`${at(node)} nested svg rule ${m[0]} (use 3.5 or 4)`);
      }
      const tokens = sizeTokens(node.text);
      const sizeOnly =
        /^\s*(?:(?:[\w-]+:)*(?:w|h|size)-\S+\s*)+$/.test(node.text) &&
        tokens.every((t) => /^\d+(\.\d+)?$/.test(t.step));
      if (sizeOnly && inIconSizeTable(node)) {
        tokenProblems(tokens, DIRECT_STEPS, "in an icon size table").forEach((p) =>
          problems.push(`${at(node)} "${node.text}" ${p}`)
        );
      }
    }
    ts.forEachChild(node, visitStrings);
  };
  visitStrings(sf);
  return problems;
}

const files = sourceFiles(SRC);
const parsed = files.map(parse);
const rel = (file: string) => relative(ROOT, file);

describe("icon invariants", () => {
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

  it("renders icons at 14, 16 or 24 px only, 24 through <Icon>", () => {
    const problems = parsed
      .filter((sf) => sf.fileName.endsWith(".tsx") || sf.fileName.endsWith(".ts"))
      .filter((sf) => !/\.test\.tsx?$/.test(sf.fileName))
      .flatMap(iconSizeProblems);
    expect(problems.join("\n")).toBe("");
  });
});
