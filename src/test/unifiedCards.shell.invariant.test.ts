/**
 * The unified cards are ToolRows (plan TR1a, `unifiedCards.shell.invariant`):
 * no module of `src/components/contentRenderer/unifiedCards/` imports the
 * old card head (`src/shared/RendererHeader`), in any form a module can be
 * reached by — a static import (value or type-only), a re-export, a dynamic
 * `import()`, `require()`, an alias (`@/shared/…`) or a relative path, with
 * or without an extension. Every card that renders a paired tool call
 * renders `ToolRow`.
 *
 * The scan reads module specifiers with the TypeScript parser (comments and
 * string text elsewhere are not specifiers) and is proved both ways with
 * in-memory fixtures.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CARDS_DIR = join(ROOT, "src/components/contentRenderer/unifiedCards");
const FORBIDDEN = join(ROOT, "src/shared/RendererHeader");

/** The twelve paired-tool cards; each must render a ToolRow. */
const CARDS = ["Bash", "Read", "Grep", "Glob", "Write", "Edit", "WebSearch", "WebFetch", "Agent", "Workflow", "AskUserQuestion", "Default"].map((n) => `${n}Card.tsx`);

const norm = (p: string) => p.replace(/\\/g, "/");

/** Where a specifier points, as an extensionless absolute path (`null`: a package). */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) target = resolve(dirname(fromFile), spec);
  else return null;
  return norm(target).replace(/\.(tsx?|jsx?|mjs)$/, "").replace(/\/index$/, "");
}

/** Every module specifier the file reaches: imports, re-exports, `import()`, `require()`. */
function moduleSpecifiers(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const literal = (node: ts.Node | undefined) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const spec = literal(node.moduleSpecifier);
      if (spec !== null) out.push(spec);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literal(node.moduleReference.expression);
      if (spec !== null) out.push(spec);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) {
        const spec = literal(node.arguments[0]);
        if (spec !== null) out.push(spec);
      }
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = literal(node.argument.literal);
      if (spec !== null) out.push(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const reachesRendererHeader = (fileName: string, text: string) =>
  moduleSpecifiers(fileName, text).filter((spec) => resolveSpecifier(fileName, spec) === norm(FORBIDDEN));

const sources = () =>
  (readdirSync(CARDS_DIR, { recursive: true }) as string[])
    .map((rel) => join(CARDS_DIR, rel))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && statSync(f).isFile());

const FIXTURE = join(CARDS_DIR, "Probe.tsx");

const BYPASSES: Record<string, string> = {
  staticImport: `import { Renderer } from "@/shared/RendererHeader";`,
  typeOnly: `import type { Renderer } from "@/shared/RendererHeader";`,
  relative: `import { Renderer } from "../../../shared/RendererHeader";`,
  withExtension: `import { Renderer } from "@/shared/RendererHeader.tsx";`,
  reExport: `export { Renderer } from "@/shared/RendererHeader";`,
  starReExport: `export * from "../../../shared/RendererHeader";`,
  dynamicImport: `export const load = () => import("@/shared/RendererHeader");`,
  templateDynamic: "export const load = () => import(`@/shared/RendererHeader`);",
  requireCall: `declare const require: (s: string) => unknown; export const m = require("@/shared/RendererHeader");`,
  importType: `export type R = typeof import("@/shared/RendererHeader");`,
  sideEffect: `import "@/shared/RendererHeader";`,
};

const LEGIT: Record<string, string> = {
  rendererDefaults: `import { RendererDefaultsContext } from "@/shared/rendererDefaults";`,
  comment: `// The old head was "@/shared/RendererHeader"; it is gone.\nexport const x = 1;`,
  stringText: `export const note = "@/shared/RendererHeader";`,
  toolRow: `import { ToolRow } from "../../transcript/ToolRow";`,
  similarName: `import { X } from "@/shared/RendererHeaderLegacy";`,
};

describe("unified cards shell invariant", () => {
  it.each(Object.keys(BYPASSES))("reports the bypass form: %s", (name) => {
    expect(reachesRendererHeader(FIXTURE, BYPASSES[name] as string).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(LEGIT))("passes the legitimate form: %s", (name) => {
    expect(reachesRendererHeader(FIXTURE, LEGIT[name] as string)).toEqual([]);
  });

  it("no module of unifiedCards/ imports RendererHeader", () => {
    const offenders = sources().flatMap((file) => reachesRendererHeader(file, readFileSync(file, "utf8")).map((spec) => `${norm(file).replace(`${norm(ROOT)}/`, "")} → ${spec}`));
    expect(offenders).toEqual([]);
  });

  it("every paired-tool card renders a ToolRow", () => {
    const missing = CARDS.filter((file) => !/<ToolRow\b/.test(readFileSync(join(CARDS_DIR, file), "utf8")));
    expect(missing).toEqual([]);
  });
});
