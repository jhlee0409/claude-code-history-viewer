/**
 * Only the outcome adapter reads tool-result shapes (plan §4.2, TR0).
 *
 * `normalizeResult` in toolOutcome.ts is the single reader of `is_error`,
 * `error_code`, exit-code aliases, `interrupted`, stdout/stderr and the #727
 * inline per-result metadata (`toolUseResult`); the provenance envelope
 * (`toolUseResultSource`, `unassignedToolUseResult`) is read by nothing in
 * the transcript UI, the adapter included. Every module under
 * `src/components/transcript/` (recursively), every module of the unified
 * cards folder (TR0's ToolRow cards and, since TR0b, the six cards that state
 * their outcome through it, their shared helpers included) and StringRenderer
 * must go through it: this static
 * scan fails on any read of those fields elsewhere — property access,
 * element access, destructuring, an `in` check or the field name as a
 * string handed to a helper (`str(r, "stdout")`, `Reflect.get`, a key
 * constant). A key built from constant parts (`"exit" + "Code"`, a template
 * literal of constants, a `const` holding either) is folded to the name it
 * spells first.
 *
 * Reads of the adapter's own outputs (`NormalizedResult`, `ToolOutcome`,
 * `ResultContent`, `ContentPart`) are allowed. The receiver is judged by the
 * real TypeScript program — the app's tsconfig, its lib, node_modules types
 * and the real in-tree modules — so a field read is judged by what it reads
 * from, not by its name alone.
 *
 * `code` is the bare exit-code alias, and also a common field of other
 * things (an error object, a key event). A `code` read fails when its
 * receiver is result-like: `any` / `unknown` / an unresolved type, a type
 * with an index signature (`Record<string, unknown>`, `ToolResultLike`
 * wherever it is declared), a type that does not declare `code` itself, or
 * a cast / `const` alias whose source is any of these. A receiver whose type
 * declares `code` (an imported error interface, a DOM or React key event, a
 * local event interface) passes.
 *
 * `content` (TR1a, amendment 7) is judged the same way: a result's content
 * is read only by the adapter (`resultContent`, `firstResultText`, `splitLeadingResultText`,
 * `rendererContent`), so no card can inspect its text to decide an outcome
 * or pick a part to show. A `content` read fails on a result-like receiver
 * (property access, element access, destructuring); a typed value that
 * declares `content` (a message, an adapter output) passes.
 *
 * Every paired-tool card states its outcome through `toolOutcome` (the
 * coverage test below): none decides it itself.
 *
 * Limits, stated rather than claimed away: a key computed at run time
 * (`r[key()]`) cannot be resolved statically and is not reported; and a
 * value already typed with a hand-written interface that declares `code`
 * (a parameter `x: { code: number }` handed in from elsewhere) is judged by
 * that type, since the scan cannot see where the value came from across a
 * call boundary. The bare word `content` is not reported as a string
 * (`str(input, "content")` reads a tool *input*, `output_mode === "content"`
 * compares an input value): only its member reads are judged.
 *
 * The scanner is proved both ways with in-memory fixtures (resolved against
 * the real modules): every known bypass form must be reported, every
 * legitimate form must pass.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const TRANSCRIPT_DIR = join(ROOT, "src/components/transcript");
const ADAPTER = join(TRANSCRIPT_DIR, "toolOutcome.ts");
const CARDS_DIR = join(ROOT, "src/components/contentRenderer/unifiedCards");

/**
 * Files that must not read result shapes themselves (beyond the transcript
 * folder): every card, named so a renamed or dropped card fails the coverage
 * test, and StringRenderer. The whole cards folder is scanned as well.
 */
const ADOPTERS = [
  ...["BashCard", "ReadCard", "GrepCard", "GlobCard", "WriteCard", "EditCard"].map((n) => join(CARDS_DIR, `${n}.tsx`)),
  // TR0b: their status and error frame come from toolOutcome.
  ...["WebFetchCard", "WebSearchCard", "AgentCard", "AskUserQuestionCard", "WorkflowCard", "DefaultCard"].map((n) => join(CARDS_DIR, `${n}.tsx`)),
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

/** The bare exit-code alias; guarded on result receivers only (see above). */
const CODE_ALIAS = "code";
/** A result's content (TR1a); guarded on result receivers only, member reads only. */
const CONTENT = "content";
/** Fields judged by their receiver: allowed where the receiver's type declares them. */
const RECEIVER_JUDGED = new Set([CODE_ALIAS, CONTENT]);
const isGuardedName = (name: string) => GUARDED.has(name) || RECEIVER_JUDGED.has(name);
/** Names also reported as bare strings and folded keys (`content` is not: see above). */
const isGuardedString = (name: string) => isGuardedName(name) && name !== CONTENT;

const isSourceFile = (name: string) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts");

/** Every source module under `dir`, recursively (tests and declarations excluded). */
function sourcesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((rel) => join(dir, rel))
    .filter((file) => isSourceFile(file) && statSync(file).isFile());
}

function scannedFiles(): string[] {
  return [...new Set([...sourcesUnder(TRANSCRIPT_DIR).filter((f) => f !== ADAPTER), ...sourcesUnder(CARDS_DIR), ...ADOPTERS])];
}

interface Violation {
  file: string;
  line: number;
  field: string;
  form: string;
}

const norm = (p: string) => p.replace(/\\/g, "/");

/**
 * The real program: the app's tsconfig (lib, `@/` paths, node_modules
 * types) and the real in-tree modules, with the in-memory fixtures laid over
 * the file system.
 */
function createScanProgram(virtual: Record<string, string>, roots: string[]) {
  const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.app.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!config) throw new Error("tsconfig.app.json did not parse");
  const options: ts.CompilerOptions = { ...config.options, noEmit: true, incremental: false, composite: false, tsBuildInfoFile: undefined };
  const host = ts.createCompilerHost(options, true);
  const base = { fileExists: host.fileExists, readFile: host.readFile, getSourceFile: host.getSourceFile };
  host.fileExists = (fileName) => norm(fileName) in virtual || base.fileExists(fileName);
  host.readFile = (fileName) => virtual[norm(fileName)] ?? base.readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const text = virtual[norm(fileName)];
    return text === undefined ? base.getSourceFile(fileName, languageVersion, ...rest) : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  return ts.createProgram({ rootNames: [...roots, ADAPTER], options, host });
}

/** The adapter's raw input types: declared there, but they are the result shapes themselves. */
const ADAPTER_INPUTS = new Set(["ToolResultLike", "ToolUseLike"]);

function findResultReads(program: ts.Program, fileName: string): Violation[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName);
  if (!source) throw new Error(`not in the scan program: ${fileName}`);
  const out: Violation[] = [];
  const report = (node: ts.Node, field: string, form: string) =>
    out.push({ file: norm(fileName), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, field, form });

  /** The interface / type alias a declaration sits in (or is). */
  const enclosingTypeName = (node: ts.Node): string | undefined => {
    for (let n: ts.Node | undefined = node; n && !ts.isSourceFile(n); n = n.parent) {
      if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return n.name.text;
    }
    return undefined;
  };
  /** Declared by the adapter, and not one of its raw input types. */
  const inAdapter = (symbol: ts.Symbol | undefined) =>
    !!symbol?.declarations?.some((d) => norm(d.getSourceFile().fileName) === norm(ADAPTER) && !ADAPTER_INPUTS.has(enclosingTypeName(d) ?? ""));
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
  /**
   * The string a key expression spells when every part is constant: string /
   * number literals, `+`, template literals, parentheses and type assertions,
   * and `const` variables holding any of these. `null` when any part is not.
   */
  const foldKey = (node: ts.Node, depth = 0): string | null => {
    if (depth > 16) return null;
    const literal = literalText(node);
    if (literal !== null) return literal;
    if (ts.isNumericLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
      return foldKey(node.expression, depth + 1);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = foldKey(node.left, depth + 1);
      const right = left === null ? null : foldKey(node.right, depth + 1);
      return left === null || right === null ? null : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const part = foldKey(span.expression, depth + 1);
        if (part === null) return null;
        text += part + span.literal.text;
      }
      return text;
    }
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const decl = symbol?.valueDeclaration;
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) {
        return foldKey(decl.initializer, depth + 1);
      }
    }
    return null;
  };
  /** `a + b` or a template literal with substitutions: a key built from parts. */
  const isCompound = (node: ts.Node) =>
    (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) || ts.isTemplateExpression(node);
  const markSubtree = (node: ts.Node) => {
    handled.add(node);
    ts.forEachChild(node, markSubtree);
  };
  /**
   * Could a value of this type be a tool result (or its content), as far as
   * `field` goes? `any` / `unknown` / unresolved, an index signature, or no
   * own declaration of `field` (`code`, `content`).
   */
  const resultLikeType = (type: ts.Type, field: string): boolean => {
    const t = checker.getNonNullableType(type);
    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true;
    if (t.isUnion()) return t.types.some((member) => resultLikeType(member, field));
    if (fromAdapter(t)) return false;
    if (checker.getIndexInfosOfType(t).length > 0) return true;
    return (t.getProperty(field)?.declarations ?? []).length === 0;
  };
  /** Is the value result-like, or a cast / variable alias of one? */
  const resultLikeSource = (expr: ts.Expression, field: string, depth = 0): boolean => {
    if (depth > 16) return true;
    if (resultLikeType(checker.getTypeAtLocation(expr), field)) return true;
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
      return resultLikeSource(expr.expression, field, depth + 1);
    }
    if (ts.isIdentifier(expr)) {
      const decl = checker.getSymbolAtLocation(expr)?.valueDeclaration;
      if (decl && (ts.isVariableDeclaration(decl) || ts.isParameter(decl)) && decl.initializer) return resultLikeSource(decl.initializer, field, depth + 1);
    }
    return false;
  };
  /**
   * May `field` be read from `receiver` here? Adapter outputs always; `code`
   * and `content` also when the receiver is not result-like (its type
   * declares the field, and it is not a cast or alias of a result-like value).
   */
  const allowedRead = (receiver: ts.Type, field: string, source?: ts.Expression): boolean => {
    if (fromAdapter(receiver)) return true;
    if (!RECEIVER_JUDGED.has(field)) return false;
    if (resultLikeType(receiver, field)) return false;
    return source === undefined || !resultLikeSource(source, field);
  };

  /** The value a binding pattern destructures, when it has one (`const { a } = value`). */
  const patternSource = (pattern: ts.ObjectBindingPattern): ts.Expression | undefined => {
    const owner = pattern.parent;
    return (ts.isVariableDeclaration(owner) || ts.isParameter(owner) || ts.isBindingElement(owner)) && owner.initializer ? owner.initializer : undefined;
  };
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

    if (ts.isPropertyAccessExpression(node) && isGuardedName(node.name.text)) {
      if (!allowedRead(checker.getTypeAtLocation(node.expression), node.name.text, node.expression)) report(node, node.name.text, "property access");
    }
    if (ts.isElementAccessExpression(node)) {
      const key = foldKey(node.argumentExpression);
      if (key !== null && isGuardedName(key)) {
        markSubtree(node.argumentExpression);
        if (!allowedRead(checker.getTypeAtLocation(node.expression), key, node.expression)) report(node, key, "element access");
      }
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const nameNode = node.propertyName ?? node.name;
      const field = ts.isIdentifier(nameNode) ? nameNode.text : ts.isComputedPropertyName(nameNode) ? foldKey(nameNode.expression) : literalText(nameNode);
      if (field !== null && isGuardedName(field)) {
        if (nameNode !== node.name) markSubtree(nameNode);
        if (!allowedRead(checker.getTypeAtLocation(node.parent), field, patternSource(node.parent))) report(node, field, "destructuring");
      }
    }
    // A key built from constant parts is judged whole, once (its parts are not names).
    if (isCompound(node) && !handled.has(node)) {
      const folded = foldKey(node);
      if (folded !== null) {
        markSubtree(node);
        if (isGuardedString(folded) && !isAdapterValue(node)) report(node, folded, "computed field name");
      }
    }
    const text = literalText(node);
    if (text !== null && isGuardedString(text) && !handled.has(node) && !isAdapterValue(node)) report(node, text, "field name as a string");

    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(TRANSCRIPT_DIR, "__scan_fixtures__");
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
  // A raw result type, wherever it is declared, is result-like (review R2-F4).
  rawResultTypeAdapter: `import type { ToolResultLike } from "@/components/transcript/toolOutcome"; declare const x: ToolResultLike; export const f = () => [x.is_error, x.code];`,
  rawResultTypeCards: `import type { ToolResultLike } from "@/components/contentRenderer/unifiedCards/shared"; declare const x: ToolResultLike; export const f = () => x.code;`,
  cardPropsResult: `import type { Props } from "@/components/contentRenderer/unifiedCards/shared"; export const f = ({ toolResults }: Props) => toolResults[0]?.code;`,
  // A result value cast to a type that names `code`: the cast's source decides.
  bareCodeCastAlias: `interface Shaped { code?: number } const s = r as Shaped; export const f = () => s.code;`,
  bareCodeUnknownCast: `declare const u: unknown; export const f = () => (u as { code: number }).code;`,
  bareCodeCastDestructure: `interface Shaped { code?: number } const { code } = r as Shaped; export const f = () => code;`,
  // A result's content is the adapter's to read (TR1a, amendment 7).
  contentRead: `export const f = () => r.content;`,
  contentOptional: `export const f = () => r?.content;`,
  contentElement: `export const f = () => r["content"];`,
  contentDestructure: `const { content } = r; export const f = () => content;`,
  contentAny: `export const f = () => (r as any).content;`,
  contentCastAlias: `interface Shaped { content?: string } const s = r as Shaped; export const f = () => s.content;`,
  contentCardProps: `import type { Props } from "@/components/contentRenderer/unifiedCards/shared"; export const f = ({ toolResults }: Props) => toolResults[0]?.content;`,
  contentResultLike: `import type { ToolResultLike } from "@/components/transcript/toolOutcome"; export const f = (x: ToolResultLike) => typeof x.content === "string";`,
};

/** Each must pass with no report. */
const LEGIT: Record<string, string> = {
  adapterOutput: `const n = normalizeResult(r); export const f = () => [n.stderr, n.stdout, n.exitCode, n.interrupted, n.isError, n.errorCode];`,
  outcomeRead: `const o: ToolOutcome = toolOutcome(null, [r], "process"); export const f = () => o.exitCode;`,
  optionalOutcome: `declare const o: ToolOutcome | undefined; export const f = () => o?.exitCode;`,
  adapterDestructure: `const { stdout, stderr } = normalizeResult(r); export const f = () => [stdout, stderr];`,
  i18nKey: `declare function t(k: string): string; export const f = () => t("renderers.toolRow.exitCode");`,
  construct: `const n = normalizeResult(r); export const props = { errorText: n.stderr, text: n.stdout };`,
  otherFields: `export const f = () => [r.tool_use_id, r.type];`,
  // `content` of a value whose type declares it (a message), and the adapter's outputs.
  typedContent: `interface Message { content: string } declare const m: Message; export const f = () => m.content;`,
  adapterContent: `import { resultContent } from "@/components/transcript/toolOutcome"; export const f = () => resultContent(r).parts;`,
  contentAssigned: `export const f = () => ({ ...r, content: "" });`,
  inputContentString: `declare const input: R; export const f = () => str(input, "content");`,
  lifecycleCompare: `const o = toolOutcome(null, [r], "process"); export const f = () => o.lifecycle === "interrupted" || "interrupted" !== o.lifecycle;`,
  lifecycleSwitch: `const o = toolOutcome(null, [r], "process"); export function f() { switch (o.lifecycle) { case "interrupted": return 1; default: return 0; } }`,
  jsxAttributeText: `export const el = <span data-outcome-icon="interrupted" data-zone="stderr" />;`,
  lifecycleValue: `export const o: ToolOutcome = { lifecycle: "interrupted", verdict: "unknown", reason: "interrupted" };`,
  // Constant folding only reports what folds to a guarded name.
  unguardedConcat: `declare function t(k: string): string; export const f = () => t("renderers." + "toolRow.exitCode");`,
  dynamicTemplate: "const n = normalizeResult(r); export const f = () => `${n.exitCode}`;",
  adapterValueConcat: `const o = toolOutcome(null, [r], "process"); export const f = () => o.lifecycle === "inter" + "rupted";`,
  // `code` that is not a result's: a type that declares `code` itself (an
  // error object, a key event), resolved through the real modules; an i18n
  // value; a DOM attribute.
  realModuleCode: `import { extractCodeFromNumberedLines } from "@/components/renderers/utils"; export const f = (s: string) => extractCodeFromNumberedLines(s).code;`,
  realModuleDestructure: `import { extractCodeFromNumberedLines } from "@/components/renderers/utils"; export const f = (s: string) => { const { code } = extractCodeFromNumberedLines(s); return code; };`,
  domKeyEvent: `export const f = (e: KeyboardEvent) => e.code;`,
  reactKeyEvent: `import type { KeyboardEvent } from "react"; export const f = (e: KeyboardEvent<HTMLElement>) => e.code;`,
  localEventInterface: `interface KeyEventLike { code: string; key: string } declare const e: KeyEventLike; export const f = () => e.code;`,
  localEventDestructure: `interface KeyEventLike { code: string } export const f = ({ code }: KeyEventLike) => code;`,
  i18nCodeValue: `declare function t(k: string, o: object): string; const o = toolOutcome(null, [r], "process"); export const f = () => t("toolOutcome.failedExitCode", { code: o.exitCode });`,
  codeDataAttribute: `export const el = <span data-mono="code" className="font-mono text-code" />;`,
};

const fixturePath = (kind: string, name: string) => norm(join(FIXTURE_DIR, `${kind}.${name}.tsx`));

describe("result adapter ownership scan", () => {
  const virtual: Record<string, string> = {};
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
    for (const field of ["is_error", "error_code", "exitCode", "exit_code", "return_code", "returncode", "code", "content", "interrupted", "stdout", "stderr", "toolUseResult"]) {
      expect(fields, field).toContain(field);
    }
  });

  it("the adapter itself never reads the provenance envelope or the unassigned payload", () => {
    const fields = new Set(findResultReads(program, ADAPTER).map((v) => v.field));
    expect(fields.has("toolUseResultSource")).toBe(false);
    expect(fields.has("unassignedToolUseResult")).toBe(false);
  });

  it("the scope is recursive: a module in a nested transcript folder is scanned", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-scope-"));
    try {
      mkdirSync(join(dir, "nested/deeper"), { recursive: true });
      for (const file of ["a.ts", "nested/b.tsx", "nested/deeper/c.ts", "nested/b.test.tsx", "nested/types.d.ts"]) writeFileSync(join(dir, file), "export {};\n");
      const found = sourcesUnder(dir).map((f) => norm(f).replace(`${norm(dir)}/`, "")).sort();
      expect(found).toEqual(["a.ts", "nested/b.tsx", "nested/deeper/c.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("covers every transcript module and every adopting card", () => {
    expect(real.length).toBeGreaterThanOrEqual(ADOPTERS.length + 2);
    for (const file of real) expect(existsSync(file), file).toBe(true);
    // The cards folder is scanned whole: its shared helpers too.
    expect(real).toContain(join(CARDS_DIR, "shared.ts"));
  });

  it("every paired-tool card states its outcome through toolOutcome (TR1a, amendment 7)", () => {
    const cards = ADOPTERS.filter((file) => file.startsWith(CARDS_DIR));
    expect(cards).toHaveLength(12);
    const missing = cards.filter((file) => !/\btoolOutcome\(/.test(readFileSync(file, "utf8")));
    expect(missing).toEqual([]);
  });

  it("no transcript module or adopting card reads result fields outside the adapter", () => {
    const violations = real.flatMap((file) => findResultReads(program, file)).map((v) => `${v.file.replace(`${norm(ROOT)}/`, "")}:${v.line} ${v.field} (${v.form})`);
    expect(violations).toEqual([]);
  });
});
