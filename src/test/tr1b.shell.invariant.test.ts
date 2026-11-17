/**
 * TR1b shell invariant: on the Claude path, one head system — ToolRow.
 *
 * - The 16 legacy `toolUseRenderers/*` files (and their barrel) are gone
 *   (amendment 9: absorbed into the ToolRow patterns, then deleted).
 * - No module this task migrated imports an old card head: the
 *   `RendererHeader` frame, `ToolUseCard` or `ToolResultCard` — in any form
 *   a module can be reached by (static / type-only import, re-export,
 *   dynamic `import()`, `require()`, alias or relative path, with or
 *   without an extension). Proved both ways with in-memory fixtures.
 * - Every migrated tool module renders a ToolRow (directly, through
 *   `ResultRow`, or by handing the call to the same card the paired path
 *   uses).
 *
 * `ToolUseCard`, `ToolResultCard`, `RendererCard` and `RendererHeader`
 * themselves are deleted in TR1c (other providers' shapes); the content
 * blocks that are not tool calls (document, search_result, container
 * upload, redacted thinking) keep their renderer until TR1c / TR4.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const C = "src/components";
const FORBIDDEN = ["src/shared/RendererHeader", `${C}/contentRenderer/toolUseRenderers/ToolUseCard`, `${C}/contentRenderer/ToolResultCard`].map((p) => join(ROOT, p));

const LEGACY_DIR = `${C}/contentRenderer/toolUseRenderers`;
const DELETED = [
  "Agent",
  "ApplyPatch",
  "Bash",
  "Glob",
  "Grep",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "TaskCreate",
  "TaskOutput",
  "Task",
  "TaskUpdate",
  "TodoWrite",
  "UpdatePlan",
  "WebFetch",
  "WebSearch",
].map((n) => `${LEGACY_DIR}/${n}ToolRenderer.tsx`).concat(`${LEGACY_DIR}/index.ts`);

/** Migrated module → how it must render a ToolRow (the JSX element it must contain). */
const MIGRATED: Record<string, RegExp> = {
  [`${C}/contentRenderer/ToolUseRenderer.tsx`]: /<UnifiedToolExecutionRenderer\b/,
  [`${C}/messageRenderer/ClaudeToolUseDisplay.tsx`]: /<ToolUseRenderer\b/,
  [`${C}/contentRenderer/ServerToolUseRenderer.tsx`]: /<ToolRow\b/,
  [`${C}/contentRenderer/MCPToolUseRenderer.tsx`]: /<ServerToolUseRenderer\b|<ToolRow\b/,
  [`${C}/toolResultRenderer/ClaudeToolResultItem.tsx`]: /<ToolRow\b/,
  [`${C}/contentRenderer/WebSearchResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/WebFetchToolResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/MCPToolResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/TerminalExecutionResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/TextEditorCodeExecutionToolResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/ToolSearchToolResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/AdvisorToolResultRenderer.tsx`]: /<ResultRow\b/,
  [`${C}/contentRenderer/CodeExecutionToolResultRenderer.tsx`]: /<TerminalExecutionResultRenderer\b/,
  [`${C}/contentRenderer/BashCodeExecutionToolResultRenderer.tsx`]: /<TerminalExecutionResultRenderer\b/,
  [`${C}/transcript/ResultRow.tsx`]: /<ToolRow\b/,
};
/** Routers on the Claude path that must not draw an old head themselves either. */
const ROUTERS = [`${C}/contentRenderer/ClaudeContentArrayRenderer.tsx`, `${C}/toolResultRenderer/ContentArrayRenderer.tsx`];

const norm = (p: string) => p.replace(/\\/g, "/");

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) target = resolve(dirname(fromFile), spec);
  else return null;
  return norm(target).replace(/\.(tsx?|jsx?|mjs)$/, "").replace(/\/index$/, "");
}

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
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
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

const forbiddenIn = (fileName: string, text: string) =>
  moduleSpecifiers(fileName, text).filter((spec) => FORBIDDEN.map(norm).includes(resolveSpecifier(fileName, spec) ?? ""));

const FIXTURE = join(ROOT, `${C}/contentRenderer/Probe.tsx`);
const BYPASSES: Record<string, string> = {
  rendererHeader: `import { Renderer } from "@/shared/RendererHeader";`,
  toolUseCardRelative: `import { ToolUseCard } from "./toolUseRenderers/ToolUseCard";`,
  toolUseCardAlias: `import { ToolUseCard } from "@/components/contentRenderer/toolUseRenderers/ToolUseCard.tsx";`,
  toolResultCard: `import { ToolResultCard } from "./ToolResultCard";`,
  typeOnly: `import type { ToolResultCard } from "./ToolResultCard";`,
  reExport: `export { ToolUseCard } from "./toolUseRenderers/ToolUseCard";`,
  dynamicImport: `export const load = () => import("./ToolResultCard");`,
  requireCall: `declare const require: (s: string) => unknown; export const m = require("../../shared/RendererHeader");`,
  importType: `export type R = typeof import("./ToolResultCard");`,
};
const LEGIT: Record<string, string> = {
  toolRow: `import { ToolRow } from "../transcript/ToolRow";`,
  resultRow: `import { ResultRow } from "../transcript/ResultRow";`,
  similarName: `import { X } from "./ToolResultCardLegacy";`,
  stringText: `export const note = "./ToolResultCard";`,
  comment: `// was "./toolUseRenderers/ToolUseCard"\nexport const x = 1;`,
};

describe("TR1b shell invariant", () => {
  it.each(Object.keys(BYPASSES))("reports the bypass form: %s", (name) => {
    expect(forbiddenIn(FIXTURE, BYPASSES[name] as string).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(LEGIT))("passes the legitimate form: %s", (name) => {
    expect(forbiddenIn(FIXTURE, LEGIT[name] as string)).toEqual([]);
  });

  it("the 16 legacy toolUseRenderers and their barrel are deleted (amendment 9)", () => {
    expect(DELETED.filter((rel) => existsSync(join(ROOT, rel)))).toEqual([]);
  });

  it("no migrated module and no Claude-path router imports RendererHeader, ToolUseCard or ToolResultCard", () => {
    const offenders = [...Object.keys(MIGRATED), ...ROUTERS].flatMap((rel) => {
      const file = join(ROOT, rel);
      if (!existsSync(file)) return [`${rel} (missing)`];
      return forbiddenIn(file, readFileSync(file, "utf8")).map((spec) => `${rel} → ${spec}`);
    });
    expect(offenders).toEqual([]);
  });

  it("every migrated tool module renders a ToolRow (directly, via ResultRow, or via the paired path's card)", () => {
    const missing = Object.entries(MIGRATED).filter(([rel, element]) => {
      const file = join(ROOT, rel);
      return !existsSync(file) || !element.test(readFileSync(file, "utf8"));
    });
    expect(missing.map(([rel]) => rel)).toEqual([]);
  });

  it("nothing outside the deleted set still imports a legacy toolUseRenderer", () => {
    // TodoWriteList / UpdatePlanSteps (TR1a's bodies) moved with the absorption.
    const bodies = readFileSync(join(ROOT, `${C}/contentRenderer/unifiedCards/toolBodies.tsx`), "utf8");
    expect(moduleSpecifiers("toolBodies.tsx", bodies).filter((spec) => spec.includes("toolUseRenderers/"))).toEqual([]);
  });
});
