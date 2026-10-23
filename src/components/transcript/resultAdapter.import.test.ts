/**
 * Only the outcome adapter reads tool-result shapes (plan §4.2, TR0).
 *
 * `normalizeResult` in toolOutcome.ts is the single reader of `is_error`,
 * `error_code`, exit-code aliases, `interrupted`, stdout/stderr and the #727
 * inline per-result metadata (`toolUseResult`); the provenance envelope
 * (`toolUseResultSource`, `unassignedToolUseResult`) is read by nothing in
 * the transcript UI, the adapter included. The transcript components and the cards that
 * adopted ToolRow/OutputBlock must go through it: this static scan fails on
 * any read of those fields elsewhere — property access, element access,
 * destructuring, an `in` check or the field name as a string handed to a
 * helper (`str(r, "stdout")`, `Reflect.get`, a key constant).
 *
 * Reads of the adapter's own outputs (`NormalizedResult`, `ToolOutcome`) are
 * allowed; the TypeScript checker decides the receiver type, so a field read
 * is judged by what it reads from, not by its name alone.
 *
 * The scanner is proved both ways with in-memory fixtures: every known bypass
 * form must be reported, every legitimate form must pass.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const TRANSCRIPT_DIR = join(ROOT, "src/components/transcript");
const ADAPTER = join(TRANSCRIPT_DIR, "toolOutcome.ts");
const CARDS_DIR = join(ROOT, "src/components/contentRenderer/unifiedCards");

/** Files that must not read result shapes themselves. */
const ADOPTERS = [
  ...["BashCard", "ReadCard", "GrepCard", "GlobCard", "WriteCard", "EditCard"].map((n) => join(CARDS_DIR, `${n}.tsx`)),
  join(ROOT, "src/components/toolResultRenderer/StringRenderer.tsx"),
];

/** Result-shape fields owned by the adapter. */
const GUARDED = new Set([
  "is_error",
  "error_code",
  "exit_code",
  "exitCode",
  "return_code",
  "returncode",
  "interrupted",
  "stdout",
  "stderr",
  "toolUseResult",
  "toolUseResultSource",
  "unassignedToolUseResult",
]);

const isSourceFile = (name: string) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts");

function scannedFiles(): string[] {
  const own = readdirSync(TRANSCRIPT_DIR)
    .filter(isSourceFile)
    .map((n) => join(TRANSCRIPT_DIR, n))
    .filter((f) => f !== ADAPTER);
  return [...own, ...ADOPTERS];
}

interface Violation {
  file: string;
  line: number;
  field: string;
  form: string;
}

const norm = (p: string) => p.replace(/\\/g, "/");

/**
 * A small program: real files from disk plus virtual fixtures. Only imports
 * that lead to the adapter resolve (the checker needs its types); everything
 * else (React, lucide, other app modules) stays unresolved, so no lib or
 * node_modules parsing is needed.
 */
function createScanProgram(virtual: Record<string, string>, roots: string[]) {
  const options: ts.CompilerOptions = {
    noLib: true,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const readText = (fileName: string) => virtual[norm(fileName)] ?? (existsSync(fileName) ? readFileSync(fileName, "utf8") : undefined);
  host.fileExists = (fileName) => norm(fileName) in virtual || existsSync(fileName);
  host.readFile = (fileName) => readText(fileName);
  host.getSourceFile = (fileName, languageVersion) => {
    const text = readText(fileName);
    return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((name) => {
      const base = name.startsWith("@/")
        ? join(ROOT, "src", name.slice(2))
        : name.startsWith(".")
          ? resolve(dirname(containingFile), name)
          : null;
      if (!base) return undefined;
      const candidate = [base, `${base}.ts`, `${base}.tsx`].find((c) => norm(c) === norm(ADAPTER) || norm(c) in virtual);
      if (!candidate) return undefined;
      return { resolvedFileName: norm(candidate) === norm(ADAPTER) ? ADAPTER : norm(candidate), extension: candidate.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts, isExternalLibraryImport: false };
    });
  return ts.createProgram({ rootNames: [...roots, ADAPTER], options, host });
}

function findResultReads(program: ts.Program, fileName: string): Violation[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName);
  if (!source) throw new Error(`not in the scan program: ${fileName}`);
  const out: Violation[] = [];
  const report = (node: ts.Node, field: string, form: string) =>
    out.push({ file: norm(fileName), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, field, form });

  const inAdapter = (symbol: ts.Symbol | undefined) =>
    !!symbol?.declarations?.some((d) => norm(d.getSourceFile().fileName) === norm(ADAPTER));
  const fromAdapter = (type: ts.Type): boolean => {
    if (inAdapter(type.aliasSymbol)) return true;
    const t = checker.getNonNullableType(type);
    if (inAdapter(t.aliasSymbol)) return true;
    if (t.isUnion()) return t.types.every(fromAdapter);
    return inAdapter(t.getSymbol());
  };
  /** An expression that reads a member the adapter declares (`o.lifecycle`). */
  const adapterMember = (expr: ts.Expression): boolean =>
    (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) && inAdapter(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr) ? expr.name : expr));
  const adapterOperand = (expr: ts.Expression) => adapterMember(expr) || fromAdapter(checker.getTypeAtLocation(expr));
  const literalText = (node: ts.Node): string | null =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
  const handled = new Set<ts.Node>();
  const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
  /**
   * A literal that is a value of an adapter type, not a field name: compared
   * with (`o.lifecycle === "interrupted"`), switched on, or assigned to an
   * adapter-typed slot (`lifecycle: "interrupted"`); or a data-/aria- attribute's text.
   */
  const isAdapterValue = (literal: ts.Node): boolean => {
    const parent = literal.parent;
    // A DOM data-/aria- attribute's text (`data-outcome-icon="interrupted"`)
    // reads nothing; a component prop could hand a field name on, so it counts.
    if (ts.isJsxAttribute(parent)) return /^(data|aria)-/.test(parent.name.getText());
    if (ts.isBinaryExpression(parent) && EQUALITY.has(parent.operatorToken.kind)) {
      const other = parent.left === literal ? parent.right : parent.left;
      return adapterOperand(other);
    }
    if (ts.isCaseClause(parent) && parent.expression === literal) {
      return adapterOperand(parent.parent.parent.expression);
    }
    const contextual = ts.isExpression(literal) ? checker.getContextualType(literal) : undefined;
    return contextual !== undefined && fromAdapter(contextual);
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

    if (ts.isPropertyAccessExpression(node) && GUARDED.has(node.name.text)) {
      if (!fromAdapter(checker.getTypeAtLocation(node.expression))) report(node, node.name.text, "property access");
    }
    if (ts.isElementAccessExpression(node)) {
      const key = literalText(node.argumentExpression);
      if (key !== null && GUARDED.has(key)) {
        handled.add(node.argumentExpression);
        if (!fromAdapter(checker.getTypeAtLocation(node.expression))) report(node, key, "element access");
      }
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const nameNode = node.propertyName ?? node.name;
      const field = ts.isIdentifier(nameNode) ? nameNode.text : literalText(nameNode);
      if (field !== null && GUARDED.has(field)) {
        if (nameNode !== node.name) handled.add(nameNode);
        if (!fromAdapter(checker.getTypeAtLocation(node.parent))) report(node, field, "destructuring");
      }
    }
    const text = literalText(node);
    if (text !== null && GUARDED.has(text) && !handled.has(node) && !isAdapterValue(node)) report(node, text, "field name as a string");

    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(TRANSCRIPT_DIR, "__scan_fixtures__");
/** A module outside the scanned files that declares a non-result `code` (an error type). */
const SCAN_TYPES_IMPORT = "@/__scan_types__/errors";
const SCAN_TYPES = norm(join(ROOT, "src/__scan_types__/errors.ts"));
const SCAN_TYPES_TEXT = `export interface FsError { code: string; message: string }\n`;
const HEADER = `import { normalizeResult, toolOutcome, type ToolOutcome, type NormalizedResult } from "@/components/transcript/toolOutcome";\ntype R = Record<string, unknown>;\ndeclare const r: R;\ndeclare function str(o: R, k: string): string | null;\n`;

/** Each must be reported at least once. */
const BYPASSES: Record<string, string> = {
  propertyAccess: `export const f = () => r.is_error;`,
  optionalChain: `export const f = () => r?.toolUseResult;`,
  castAny: `export const f = () => (r as any).returncode;`,
  nestedCast: `export const f = () => (r.content as R).error_code;`,
  elementLiteral: `export const f = () => r["stderr"];`,
  elementTemplate: "export const f = () => r[`stdout`];",
  keyConstant: `const key = "stderr"; export const f = () => r[key];`,
  paramDestructure: `export const f = ({ exitCode }: R) => exitCode;`,
  renamedDestructure: `const { stdout: out } = r; export const f = () => out;`,
  nestedDestructure: `const { toolUseResultSource: { association } } = r as { toolUseResultSource: { association: string } }; export const f = () => association;`,
  inCheck: `export const f = () => "interrupted" in r;`,
  fieldNameAsProp: `declare function Field(p: { name: string }): null; export const el = <Field name="stdout" />;`,
  compareKeyOnResult: `declare const k: string; export const f = () => k === "stderr" ? r[k] : null;`,
  helperString: `export const f = () => str(r, "stdout");`,
  reflectGet: `export const f = () => Reflect.get(r, "exit_code");`,
  unassigned: `declare const src: { unassignedToolUseResult?: unknown }; export const f = () => src.unassignedToolUseResult;`,
  adapterTypedButWiderUnion: `declare const x: NormalizedResult | R; export const f = () => x.stderr;`,
  // A key built from constant parts is the field name (review F3).
  computedConcat: `export const probe = r["exit" + "Code"];`,
  computedConstConcat: `const a = "exit"; const b = "Code"; export const f = () => r[a + b];`,
  computedTemplate: "export const f = () => r[`std${\"out\"}`];",
  computedTemplateConst: "const p = \"std\"; export const f = () => r[`${p}err`];",
  computedKeyToHelper: `const k = "exit" + "_code"; export const f = () => Reflect.get(r, k);`,
  computedInCheck: `export const f = () => ("inter" + "rupted") in r;`,
  computedParenthesized: `export const f = () => r[("return" + "_") + ("code" as const)];`,
  // The bare `code` exit-code alias on a result (review F3).
  bareCode: `export const probe = r.code;`,
  bareCodeOptional: `export const f = () => r?.code;`,
  bareCodeElement: `export const f = () => r["code"];`,
  bareCodeDestructure: `const { code } = r; export const f = () => code;`,
  bareCodeRenamed: `const { code: c } = r; export const f = () => c;`,
  bareCodeAny: `export const f = () => (r as any).code;`,
  bareCodeTypeLiteral: `export const f = () => (r.content as { code?: number }).code;`,
  bareCodeLocalInterface: `interface Shaped { code?: number } export const f = () => (r as Shaped).code;`,
  bareCodeHelper: `export const f = () => str(r, "code");`,
  bareCodeInCheck: `export const f = () => "code" in r;`,
};

/** Each must pass with no report. */
const LEGIT: Record<string, string> = {
  adapterOutput: `const n = normalizeResult(r); export const f = () => [n.stderr, n.stdout, n.exitCode, n.interrupted, n.isError, n.errorCode];`,
  outcomeRead: `const o: ToolOutcome = toolOutcome(null, [r], "process"); export const f = () => o.exitCode;`,
  optionalOutcome: `declare const o: ToolOutcome | undefined; export const f = () => o?.exitCode;`,
  adapterDestructure: `const { stdout, stderr } = normalizeResult(r); export const f = () => [stdout, stderr];`,
  i18nKey: `declare function t(k: string): string; export const f = () => t("renderers.toolRow.exitCode");`,
  construct: `const n = normalizeResult(r); export const props = { errorText: n.stderr, text: n.stdout };`,
  otherFields: `export const f = () => [r.content, r.tool_use_id, r.type];`,
  lifecycleCompare: `const o = toolOutcome(null, [r], "process"); export const f = () => o.lifecycle === "interrupted" || "interrupted" !== o.lifecycle;`,
  lifecycleSwitch: `const o = toolOutcome(null, [r], "process"); export function f() { switch (o.lifecycle) { case "interrupted": return 1; default: return 0; } }`,
  jsxAttributeText: `export const el = <span data-outcome-icon="interrupted" data-zone="stderr" />;`,
  lifecycleValue: `export const o: ToolOutcome = { lifecycle: "interrupted", verdict: "unknown", reason: "interrupted" };`,
  // Constant folding only reports what folds to a guarded name.
  unguardedConcat: `declare function t(k: string): string; export const f = () => t("renderers." + "toolRow.exitCode");`,
  dynamicTemplate: "const n = normalizeResult(r); export const f = () => `${n.exitCode}`;",
  adapterValueConcat: `const o = toolOutcome(null, [r], "process"); export const f = () => o.lifecycle === "inter" + "rupted";`,
  // `code` that is not a result's: a type declared outside the transcript UI
  // (an error object, a key event), an i18n value, a DOM attribute.
  foreignErrorCode: `import type { FsError } from "${SCAN_TYPES_IMPORT}"; declare const err: FsError; export const f = () => err.code;`,
  foreignErrorDestructure: `import type { FsError } from "${SCAN_TYPES_IMPORT}"; declare const err: FsError; const { code } = err; export const f = () => code;`,
  i18nCodeValue: `declare function t(k: string, o: object): string; const o = toolOutcome(null, [r], "process"); export const f = () => t("toolOutcome.failedExitCode", { code: o.exitCode });`,
  codeDataAttribute: `export const el = <span data-mono="code" className="font-mono text-code" />;`,
};

const fixturePath = (kind: string, name: string) => norm(join(FIXTURE_DIR, `${kind}.${name}.tsx`));

describe("result adapter ownership scan", () => {
  const virtual: Record<string, string> = { [SCAN_TYPES]: SCAN_TYPES_TEXT };
  for (const [name, body] of Object.entries(BYPASSES)) virtual[fixturePath("bypass", name)] = HEADER + body;
  for (const [name, body] of Object.entries(LEGIT)) virtual[fixturePath("legit", name)] = HEADER + body;
  const real = scannedFiles();
  const program = createScanProgram(virtual, [...Object.keys(virtual), ...real]);

  it.each(Object.keys(BYPASSES))("reports the bypass form: %s", (name) => {
    expect(findResultReads(program, fixturePath("bypass", name)).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(LEGIT))("passes the legitimate form: %s", (name) => {
    expect(findResultReads(program, fixturePath("legit", name))).toEqual([]);
  });

  it("sees the reads in the adapter itself (positive control)", () => {
    const fields = new Set(findResultReads(program, ADAPTER).map((v) => v.field));
    for (const field of ["is_error", "error_code", "exitCode", "exit_code", "return_code", "returncode", "interrupted", "stdout", "stderr", "toolUseResult"]) {
      expect(fields, field).toContain(field);
    }
  });

  it("the adapter itself never reads the provenance envelope or the unassigned payload", () => {
    const fields = new Set(findResultReads(program, ADAPTER).map((v) => v.field));
    expect(fields.has("toolUseResultSource")).toBe(false);
    expect(fields.has("unassignedToolUseResult")).toBe(false);
  });

  it("covers every transcript module and every adopting card", () => {
    expect(real.length).toBeGreaterThanOrEqual(ADOPTERS.length + 2);
    for (const file of real) expect(existsSync(file), file).toBe(true);
  });

  it("no transcript module or adopting card reads result fields outside the adapter", () => {
    const violations = real.flatMap((file) => findResultReads(program, file)).map((v) => `${v.file.replace(`${norm(ROOT)}/`, "")}:${v.line} ${v.field} (${v.form})`);
    expect(violations).toEqual([]);
  });
});
