/**
 * Guard: every formatter result shown as text renders through <Num>
 * (inner-UI plan F1b; Num.tsx says why).
 *
 * A formatter result is a call of a shared formatter: `fmt.tokens(n)`,
 * `appFormat().bytes(b)`, `useFormat().time(ts)`, any `const x =
 * useFormat() | appFormat() | formatterFor(…)` (`x.count(n)`, or destructured
 * `const { count } = …`), and the module functions (`formatBytes(…)`). The
 * methods are read from `formatterFor()` itself, so a new one is covered.
 * Its text flows on through `?:`, `&&`, `||`, `??`, `+`, a template, `.text`
 * (of `change`), a `const`, `useMemo`, `.map`, a function that returns it (in
 * the same file or imported from another), and a message that interpolates
 * it (`t("key", { n: fmt.count(x) })`).
 *
 * Reported: such text rendered as a bare JSX child (or as a component's whole
 * output). Allowed: inside `<Num>`; inside SVG `<text>` / `<tspan>`, which
 * never wraps; in an attribute of a DOM element (`title`, `aria-label`) or
 * any call other than `t()` (data, a toast). Handed to a component prop or an
 * object field, it is listed in HANDOFFS below: each receiver renders it
 * through <Num>, and a new handoff is a reviewed change here.
 *
 * A formatter function handed on uncalled (`formatTimeAgo={fmt.relative}`,
 * `const f = fmt.time`, `items.map(fmt.count)`) is followed too: an alias's
 * calls, a `.map`'s results, and, by its prop or field name, every component
 * that receives it (destructured, or `props.name`), where its calls are
 * formatter results under the same rule (FUNCTION_HANDOFFS). Passed anywhere
 * else (another call, returned, a DOM attribute, a `let`), it cannot be
 * followed and is reported; so is a formatter object used as a value outside
 * a hook's dependency list.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as dateModule from "./date";
import * as durationModule from "./duration";
import * as numberModule from "./number";
import { formatterFor } from "./useFormat";

const ROOT = resolve(__dirname, "../../..");
const SRC = join(ROOT, "src");

const sample = formatterFor("en");
const FORMATTER_METHODS = new Set(
  Object.keys(sample).filter((key) => typeof sample[key as keyof typeof sample] === "function"),
);
const FORMAT_FUNCTIONS = new Set(
  [numberModule, dateModule, durationModule].flatMap((module) =>
    Object.entries(module)
      .filter(([name, value]) => typeof value === "function" && /^format[A-Z]/.test(name))
      .map(([name]) => name),
  ),
);
const FORMATTER_FACTORIES = new Set(["useFormat", "appFormat", "formatterFor"]);
/** Hooks whose last argument is a dependency list, not a use. */
const HOOKS_WITH_DEPS = new Set(["useMemo", "useCallback", "useEffect", "useLayoutEffect", "useInsertionEffect", "useImperativeHandle"]);
/** SVG text never wraps, so a number there cannot split. */
const NEVER_WRAPS = new Set(["text", "tspan", "textPath"]);

export interface SourceFile {
  /** Repo path with `/` (`src/components/X.tsx`). */
  path: string;
  text: string;
}

export interface NumScan {
  /** `path:line: code` of every formatter result rendered bare. */
  bare: string[];
  /** `path: Component.prop` / `path: field name` of every handoff. */
  handoffs: string[];
  /** `path: Component.prop` / `path: field name` where a formatter function (uncalled) is handed on. */
  functionHandoffs: string[];
  /** Each handed-on function's prop or field name → the files that receive it. */
  functionReceivers: Record<string, string[]>;
  /** `path:line: code` of a formatter function or object passed where it cannot be followed. */
  untracked: string[];
  /** The bare JSX children themselves (`{…}`), by file and offset. */
  sites: { path: string; start: number; end: number }[];
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node;

const isWrapper = (node: ts.Node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isTypeAssertionExpression(node);

const isFunctionLike = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);

const tagName = (node: ts.JsxElement | ts.JsxOpeningLikeElement) =>
  (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();

const isComponentTag = (name: string) => /^[A-Z]/.test(name) || name.includes(".");

const calleeName = (call: ts.CallExpression) => {
  const callee = unwrap(call.expression);
  return ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
};

/** `props` in `props.name`: a parameter of an enclosing function. */
function isParameter(id: ts.Identifier): boolean {
  for (let fn = ts.findAncestor(id.parent, isFunctionLike); fn; fn = ts.findAncestor(fn.parent, isFunctionLike)) {
    if (fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === id.text)) return true;
  }
  return false;
}

/** `node` is used as a value where it is not called: an argument, a prop, a field, an initializer, an element, a result. */
function usedUncalled(node: ts.Node): boolean {
  let top = node;
  while (isWrapper(top.parent)) top = top.parent;
  const p = top.parent;
  if (ts.isCallExpression(p)) return p.expression !== top;
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    return (op === ts.SyntaxKind.AmpersandAmpersandToken && p.right === top) || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken;
  }
  return (
    ts.isJsxExpression(p) ||
    (ts.isVariableDeclaration(p) && p.initializer === top) ||
    (ts.isPropertyAssignment(p) && p.initializer === top) ||
    (ts.isShorthandPropertyAssignment(p) && p.name === top) ||
    ts.isArrayLiteralExpression(p) ||
    ts.isReturnStatement(p) ||
    (ts.isArrowFunction(p) && p.body === top) ||
    (ts.isConditionalExpression(p) && p.condition !== top)
  );
}

/** Where a value ends up after the expressions that pass it on unchanged (or keep it as text). */
function valueEnd(node: ts.Node): { child: ts.Node; parent: ts.Node } {
  let child = node;
  let parent = node.parent;
  for (;;) {
    if (isWrapper(parent)) {
      [child, parent] = [parent, parent.parent];
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.condition !== child) {
      [child, parent] = [parent, parent.parent];
      continue;
    }
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      const passes =
        (op === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === child) ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.PlusToken;
      if (passes) {
        [child, parent] = [parent, parent.parent];
        continue;
      }
    }
    if (ts.isTemplateSpan(parent) && parent.expression === child) {
      [child, parent] = [parent.parent, parent.parent.parent];
      continue;
    }
    return { child, parent };
  }
}

/** The repo path a module specifier names, if it is one of `known`. */
function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier).split(sep).join("/");
  else return undefined;
  return ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find((path) => known.has(path));
}

interface FileState {
  file: SourceFile;
  sf: ts.SourceFile;
  /** Identifiers that hold a formatter (`fmt`, `const f = appFormat()`). */
  receivers: Set<string>;
  /** Functions whose result is formatter text (destructured methods, helpers, imports). */
  functions: Set<string>;
  /** Exported helpers that return formatter text. */
  exported: Set<string>;
}

export function scanNum(files: readonly SourceFile[]): NumScan {
  const known = new Set(files.map((f) => f.path));
  const states = files.map((file): FileState => {
    const kind = file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file.path, file.text.replace(/\r\n/g, "\n"), ts.ScriptTarget.Latest, true, kind);
    return { file, sf, receivers: new Set(["fmt"]), functions: new Set(FORMAT_FUNCTIONS), exported: new Set() };
  });
  const byPath = new Map(states.map((s) => [s.file.path, s]));
  // Bind only these already-parsed files (no libs/types/disk resolution).
  // Symbols distinguish a callback parameter from unrelated same-named locals.
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [], noEmit: true, jsx: ts.JsxEmit.Preserve };
  const sourceFor = (name: string) => byPath.get(name.replaceAll("\\", "/").replace(/^\//, ""));
  const host: ts.CompilerHost = {
    ...ts.createCompilerHost(options),
    getCurrentDirectory: () => "/",
    getSourceFile: (name) => sourceFor(name)?.sf,
    fileExists: (name) => sourceFor(name) !== undefined,
    readFile: (name) => sourceFor(name)?.sf.text,
  };
  const checker = ts.createProgram(states.map((state) => state.file.path), options, host).getTypeChecker();
  const adapterParameters = new Set<ts.Symbol>();
  const isAdapterParameter = (node: ts.Node): boolean => {
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && adapterParameters.has(symbol);
  };

  // Formatter bindings: `const f = useFormat()`, `const { count, tokens: tk } = appFormat()`.
  for (const state of states) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && FORMATTER_FACTORIES.has(init.expression.text)) {
          if (ts.isIdentifier(node.name)) state.receivers.add(node.name.text);
          else if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              const method = (element.propertyName ?? element.name).getText(state.sf);
              if (FORMATTER_METHODS.has(method) && ts.isIdentifier(element.name)) state.functions.add(element.name.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(state.sf);
  }

  const bare = new Map<string, string>();
  const handoffs = new Set<string>();
  const sites = new Map<string, NumScan["sites"][number]>();
  const functionHandoffs = new Set<string>();
  const untracked = new Map<string, string>();
  /** Prop and field names that carry a formatter function to the components that receive them. */
  const functionNames = new Set<string>();
  let changed = true;

  /** `props.formatTimeAgo`: a handed-on formatter function, read from a parameter. */
  const isReceivedFunction = (node: ts.Node) =>
    ts.isPropertyAccessExpression(node) && functionNames.has(node.name.text) && ts.isIdentifier(node.expression) && isParameter(node.expression);

  const isFormatterText = (state: FileState, node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrap(node.expression);
    if (ts.isIdentifier(callee)) return state.functions.has(callee.text) || isAdapterParameter(callee);
    if (isReceivedFunction(callee)) return true;
    if (!ts.isPropertyAccessExpression(callee) || !FORMATTER_METHODS.has(callee.name.text)) return false;
    const receiver = unwrap(callee.expression);
    if (ts.isIdentifier(receiver)) return state.receivers.has(receiver.text);
    return ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) && FORMATTER_FACTORIES.has(receiver.expression.text);
  };

  const report = (state: FileState, at: ts.Node) => {
    const { line } = state.sf.getLineAndCharacterOfPosition(at.getStart(state.sf));
    const code = state.sf.text.split("\n")[line]!.trim();
    bare.set(`${state.file.path}:${at.getStart(state.sf)}`, `${state.file.path}:${line + 1}: ${code}`);
  };

  /** Every identifier `name` used as a value inside `scope`. */
  const references = (scope: ts.Node, name: string, declaration: ts.Node): ts.Identifier[] => {
    const out: ts.Identifier[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === name && node !== declaration) {
        const p = node.parent;
        const isName =
          (ts.isPropertyAccessExpression(p) && p.name === node) ||
          (ts.isPropertyAssignment(p) && p.name === node) ||
          ts.isJsxAttribute(p) ||
          (ts.isVariableDeclaration(p) && p.name === node) ||
          ts.isBindingElement(p) ||
          ts.isParameter(p);
        if (!isName) out.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
    return out;
  };

  const seen = new Set<ts.Node>();
  /**
   * Follow formatter text from `source` to where it ends. `inMessage`: the
   * text is a message that holds a formatter result (`t("key", { n: … })`);
   * it must render through <Num> as text, and is no handoff elsewhere.
   */
  const follow = (state: FileState, source: ts.Node, inMessage = false): void => {
    if (seen.has(source)) return;
    seen.add(source);
    let { child, parent } = valueEnd(source);
    // `fmt.change(a, b).text`
    while (ts.isPropertyAccessExpression(parent) && parent.expression === child && parent.name.text === "text") {
      ({ child, parent } = valueEnd(parent));
    }
    if (ts.isJsxExpression(parent)) {
      const host = parent.parent;
      if (ts.isJsxElement(host) || ts.isJsxFragment(host)) {
        const tag = ts.isJsxElement(host) ? tagName(host) : "";
        if (tag !== "Num" && !NEVER_WRAPS.has(tag)) {
          report(state, source);
          sites.set(`${state.file.path}:${parent.getStart(state.sf)}`, { path: state.file.path, start: parent.getStart(state.sf), end: parent.end });
        }
        return;
      }
      if (ts.isJsxAttribute(host) && !inMessage) {
        const element = host.parent.parent;
        const tag = tagName(element);
        if (isComponentTag(tag)) handoffs.add(`${state.file.path}: ${tag}.${host.name.getText(state.sf)}`);
      }
      return;
    }
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer === child) {
      const list = parent.parent;
      if (ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const) {
        const scope = list.parent.parent;
        for (const ref of references(scope, parent.name.text, parent.name)) follow(state, ref, inMessage);
        if (isFunctionLike(unwrap(parent.initializer))) return;
      }
      return;
    }
    if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) {
      const call = parent.parent.parent;
      if (ts.isCallExpression(call)) {
        // A message that interpolates it (`t("key", { n: fmt.count(x) })`) is
        // text holding the number; any other call takes it as data.
        const callee = unwrap(call.expression);
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (name === "t") follow(state, call, true);
        return;
      }
      if (inMessage) return;
      let holder: ts.Node = parent.parent;
      while (ts.isArrayLiteralExpression(holder.parent) || isWrapper(holder.parent)) holder = holder.parent;
      const field = parent.name.getText(state.sf);
      if (ts.isJsxExpression(holder.parent) && ts.isJsxAttribute(holder.parent.parent)) {
        const attribute = holder.parent.parent;
        handoffs.add(`${state.file.path}: ${tagName(attribute.parent.parent)}.${attribute.name.getText(state.sf)}`);
      } else {
        handoffs.add(`${state.file.path}: field ${field}`);
      }
      return;
    }
    const fn = ts.isReturnStatement(parent)
      ? ts.findAncestor(parent, isFunctionLike)
      : ts.isArrowFunction(parent) && parent.body === child
        ? parent
        : undefined;
    if (!fn) return;
    // The function itself, or the useCallback(fn) that holds it.
    let holder: ts.Node = fn;
    const call = fn.parent;
    if (ts.isCallExpression(call) && call.arguments[0] === fn) {
      const callee = unwrap(call.expression);
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      // useMemo(() => text) is text; items.map((i) => text) renders as text nodes.
      if (["useMemo", "map", "flatMap"].includes(name)) return follow(state, call, inMessage);
      if (name !== "useCallback") return;
      holder = call;
    }
    const named = ts.isFunctionDeclaration(fn)
      ? fn.name
      : ts.isVariableDeclaration(holder.parent)
        ? holder.parent.name
        : undefined;
    if (!named || !ts.isIdentifier(named)) return;
    if (/^[A-Z]/.test(named.text)) {
      // A component whose output is the text itself.
      report(state, source);
      return;
    }
    if (!state.functions.has(named.text)) {
      state.functions.add(named.text);
      changed = true;
    }
    const statement = ts.isFunctionDeclaration(fn) ? fn : holder.parent.parent.parent;
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && !state.exported.has(named.text)) {
      state.exported.add(named.text);
      changed = true;
    }
  };

  /** What a formatter function used uncalled is: "function" (`fmt.relative`, `formatBytes`, a received `formatTimeAgo`), "formatter" (`fmt` itself). */
  const uncalledFormatter = (state: FileState, node: ts.Node): "function" | "formatter" | undefined => {
    if (!(ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) || !usedUncalled(node)) return undefined;
    if (ts.isIdentifier(node)) {
      if (state.functions.has(node.text) || isAdapterParameter(node)) return "function";
      return state.receivers.has(node.text) ? "formatter" : undefined;
    }
    if (isReceivedFunction(node)) return "function";
    if (!FORMATTER_METHODS.has(node.name.text)) return undefined;
    const receiver = unwrap(node.expression);
    const isFormatter = ts.isIdentifier(receiver)
      ? state.receivers.has(receiver.text)
      : ts.isCallExpression(receiver) && ts.isIdentifier(receiver.expression) && FORMATTER_FACTORIES.has(receiver.expression.text);
    return isFormatter ? "function" : undefined;
  };

  /**
   * Follow a formatter function handed on uncalled: an alias's calls and a
   * `.map`'s results are formatter text; a prop or field carries its name to
   * the components that receive it; anywhere else it cannot be followed.
   */
  const followFunction = (state: FileState, source: ts.Node, kind: "function" | "formatter"): void => {
    if (seen.has(source)) return;
    seen.add(source);
    const { sf } = state;
    const { child, parent } = valueEnd(source);
    // A hook's dependency list.
    if (ts.isArrayLiteralExpression(parent) && ts.isCallExpression(parent.parent) && parent.parent.arguments.indexOf(parent) > 0 && HOOKS_WITH_DEPS.has(calleeName(parent.parent))) return;
    const untrack = () => {
      const { line } = sf.getLineAndCharacterOfPosition(source.getStart(sf));
      untracked.set(`${state.file.path}:${source.getStart(sf)}`, `${state.file.path}:${line + 1}: ${sf.text.split("\n")[line]!.trim()}`);
    };
    if (kind === "formatter") return untrack();
    const carry = (name: string) => {
      if (functionNames.has(name)) return;
      functionNames.add(name);
      changed = true;
    };
    if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) {
      const attribute = parent.parent;
      const tag = tagName(attribute.parent.parent);
      if (!isComponentTag(tag)) return untrack();
      const prop = attribute.name.getText(sf);
      functionHandoffs.add(`${state.file.path}: ${tag}.${prop}`);
      return carry(prop);
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === child && ts.isIdentifier(parent.name)) {
      const list = parent.parent;
      if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return untrack();
      // An alias (`const f = fmt.time`): its calls are formatter results.
      if (!state.functions.has(parent.name.text)) {
        state.functions.add(parent.name.text);
        changed = true;
      }
      return;
    }
    if (ts.isShorthandPropertyAssignment(parent) || (ts.isPropertyAssignment(parent) && parent.initializer === child)) {
      const field = parent.name.getText(sf);
      functionHandoffs.add(`${state.file.path}: field ${field}`);
      return carry(field);
    }
    // items.map(fmt.count): its results are formatter text.
    if (ts.isCallExpression(parent) && parent.arguments[0] === child && ["map", "flatMap"].includes(calleeName(parent))) return follow(state, parent);
    // A resolvable adapter's positional callback is followed into its real
    // parameter and back through its return/export, not exempted by name.
    // Unresolved/external calls remain untracked below.
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression)) {
      let target = state;
      let name = parent.expression.text;
      for (const statement of state.sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        const binding = bindings.elements.find((element) => element.name.text === name);
        if (!binding) continue;
        const path = resolveImport(state.file.path, statement.moduleSpecifier.text, known);
        if (path) {
          target = byPath.get(path)!;
          name = (binding.propertyName ?? binding.name).text;
        }
        break;
      }
      const fn = target.sf.statements.find((statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === name);
      const parameter = fn?.parameters[parent.arguments.indexOf(child as ts.Expression)];
      if (parameter && ts.isIdentifier(parameter.name)) {
        const binding = checker.getSymbolAtLocation(parameter.name);
        if (binding) {
          if (!adapterParameters.has(binding)) {
            adapterParameters.add(binding);
            changed = true;
          }
          return;
        }
      }
    }
    untrack();
  };

  while (changed) {
    changed = false;
    // Helpers imported from a file that returns formatter text.
    for (const state of states) {
      for (const statement of state.sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const target = resolveImport(state.file.path, statement.moduleSpecifier.text, known);
        const bindings = statement.importClause?.namedBindings;
        if (!target || !bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (byPath.get(target)!.exported.has(imported) && !state.functions.has(element.name.text)) {
            state.functions.add(element.name.text);
            changed = true;
          }
        }
      }
    }
    // Components that receive a handed-on formatter function by its name (`({ formatTimeAgo })`, `{ formatTimeAgo: ago } = data`).
    for (const state of states) {
      const visit = (node: ts.Node): void => {
        if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && functionNames.has((node.propertyName ?? node.name).getText(state.sf)) && !state.functions.has(node.name.text)) {
          state.functions.add(node.name.text);
          changed = true;
        }
        ts.forEachChild(node, visit);
      };
      if (functionNames.size > 0) visit(state.sf);
    }
    seen.clear();
    for (const state of states) {
      const visit = (node: ts.Node): void => {
        if (isFormatterText(state, node)) follow(state, node);
        else {
          const kind = uncalledFormatter(state, node);
          if (kind) followFunction(state, node, kind);
        }
        ts.forEachChild(node, visit);
      };
      visit(state.sf);
    }
  }

  const functionReceivers: Record<string, string[]> = {};
  for (const name of functionNames) {
    functionReceivers[name] = states
      .filter((state) => {
        let found = false;
        const visit = (node: ts.Node): void => {
          if (found) return;
          if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(state.sf) === name) found = true;
          else if (ts.isPropertyAccessExpression(node) && node.name.text === name && ts.isIdentifier(node.expression) && isParameter(node.expression)) found = true;
          else ts.forEachChild(node, visit);
        };
        visit(state.sf);
        return found;
      })
      .map((state) => state.file.path);
  }
  return {
    bare: [...bare.values()],
    handoffs: [...handoffs].sort(),
    functionHandoffs: [...functionHandoffs].sort(),
    functionReceivers,
    untracked: [...untracked.values()],
    sites: [...sites.values()],
  };
}

// ---------------------------------------------------------------------------

/**
 * Every formatter result the app hands to a component prop or an object
 * field, and so renders where it arrives. A new entry is a reviewed change:
 * route the text through <Num> where it is rendered and name that place in
 * RECEIVERS.
 */
const HANDOFFS = [
  "src/components/AnalyticsDashboard/components/ActivityHeatmap.tsx: ChartTooltip.rows",
  "src/components/AnalyticsDashboard/components/ActivityHeatmap.tsx: ChartTooltip.title",
  "src/components/AnalyticsDashboard/components/DailyTrendChart.tsx: ChartTooltip.rows",
  "src/components/AnalyticsDashboard/components/DailyTrendChart.tsx: ChartTooltip.title",
  "src/components/AnalyticsDashboard/components/TokenDistributionChart.tsx: ChartTooltip.rows",
  "src/components/AnalyticsDashboard/views/GlobalStatsView.tsx: MetricCard.subValue",
  "src/components/AnalyticsDashboard/views/GlobalStatsView.tsx: MetricCard.value",
  "src/components/AnalyticsDashboard/views/ProjectStatsView.tsx: MetricCard.subValue",
  "src/components/AnalyticsDashboard/views/ProjectStatsView.tsx: MetricCard.value",
  "src/components/Inspector/InspectorTokensTab.tsx: MetricRow.detail",
  "src/components/Inspector/InspectorTokensTab.tsx: MetricRow.value",
  "src/components/ProjectTree/components/LibrarySection.tsx: field caption",
  "src/components/SessionBoard/ContributionGrid.tsx: ChartTooltip.title",
];

/** Where each handoff is rendered: the receiver's file and its JSX child `{…}` that shows it. */
const RECEIVERS: Record<string, [file: string, child: string]> = {
  "ChartTooltip.rows": ["src/components/ui/chart-tooltip.tsx", "String(row.value)"],
  "ChartTooltip.title": ["src/components/ui/chart-tooltip.tsx", "title"],
  "MetricCard.value": ["src/components/AnalyticsDashboard/components/MetricCard.tsx", "String(value)"],
  "MetricCard.subValue": ["src/components/AnalyticsDashboard/components/MetricCard.tsx", "subValue"],
  "MetricRow.value": ["src/components/Inspector/InspectorTokensTab.tsx", "value"],
  "MetricRow.detail": ["src/components/Inspector/InspectorTokensTab.tsx", "detail"],
  "field caption": ["src/components/ProjectTree/components/LibrarySection.tsx", "entry.caption"],
};

/**
 * Every formatter function (not its result) the app hands on, by prop or
 * field: `formatTimeAgo={fmt.relative}`. The scan follows the name into every
 * component that receives it (destructured, or `props.name`), where a call of
 * it is a formatter result under the same rule. A new entry is a reviewed
 * change.
 */
const FUNCTION_HANDOFFS = [
  "src/components/ProjectTree/components/GroupedProjectList.tsx: ProjectSessions.formatTimeAgo",
  "src/components/ProjectTree/components/ProjectSessions.tsx: SessionItem.formatTimeAgo",
  "src/components/ProjectTree/components/ProjectSessions.tsx: SessionList.formatTimeAgo",
  "src/components/ProjectTree/components/SessionList.tsx: SessionItem.formatTimeAgo",
  "src/components/ProjectTree/components/SessionList.tsx: field formatTimeAgo",
  "src/components/ProjectTree/index.tsx: GroupedProjectList.formatTimeAgo",
  "src/components/SessionItem/SessionItem.tsx: SessionMeta.formatTimeAgo",
];

/** The tags of the JSX elements whose child `{…}` is exactly `child`, in `file`. */
function hostsOf(file: SourceFile, child: string): string[] {
  const sf = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && node.expression.getText(sf).replace(/\s+/g, "") === child) {
      if (ts.isJsxElement(node.parent)) out.push(tagName(node.parent));
      else if (ts.isJsxFragment(node.parent)) out.push("<>");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const isTest = (path: string) =>
  /\.test\.tsx?$/.test(path) || path.includes(`${sep}__tests__${sep}`) || path.includes(`${sep}test${sep}`);

function appSources(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts") && !isTest(path)) {
        out.push({ path: relative(ROOT, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(SRC);
  return out;
}

let appScan: NumScan | undefined;
const scanApp = () => (appScan ??= scanNum(appSources()));

/** Bare lines (1-based) for one in-memory `.tsx` file, plus optional others. */
const bareLines = (code: string, others: SourceFile[] = []) =>
  scanNum([{ path: "src/components/Probe.tsx", text: code }, ...others])
    .bare.filter((hit) => hit.startsWith("src/components/Probe.tsx:"))
    .map((hit) => Number(hit.split(":")[1]));

describe("<Num> guard: the formatter methods it knows", () => {
  it("reads every text method from formatterFor() and the format* functions from the modules", () => {
    expect([...FORMATTER_METHODS]).toEqual(expect.arrayContaining(["number", "tokens", "cost", "percent", "bytes", "duration", "time", "dateTime", "dayKey", "change"]));
    expect(FORMATTER_METHODS.has("language")).toBe(false);
    expect([...FORMAT_FUNCTIONS]).toEqual(expect.arrayContaining(["formatNumber", "formatBytes", "formatTime", "formatDuration", "formatDateDivider"]));
  });
});

describe("<Num> guard: a formatter result rendered bare is found", () => {
  it.each([
    ["a call as a child", "const A = () => <p>{fmt.count(n)}</p>;"],
    ["spaced out", "const A = () => <span>{ fmt . tokens (n) }</span>;"],
    ["a branch of ?:", 'const A = () => <p>{ok ? fmt.cost(c) : "—"}</p>;'],
    ["after &&", "const A = () => <p>{ok && fmt.percent(r)}</p>;"],
    ["either side of ?? and ||", 'const A = () => <p>{fmt.bytes(b) ?? "-"}{fmt.bytes(b) || "-"}</p>;'],
    ["in a template", "const A = () => <p>{`${fmt.tokens(a)} / total`}</p>;"],
    ["in a concatenation", 'const A = () => <p>{"~" + fmt.cost(c)}</p>;'],
    ["change().text", "const A = () => <p>{fmt.change(a, b).text}</p>;"],
    ["a cast", "const A = () => <p>{(fmt.count(n) as string)}</p>;"],
    ["a fragment", "const A = () => <>{fmt.count(n)}</>;"],
    ["a custom element's child", "const A = () => <Badge>{fmt.bytes(b)}</Badge>;"],
    ["an alias of appFormat()", "const date = appFormat();\nconst A = () => <p>{date.time(ts)}</p>;"],
    ["appFormat() directly", "const A = () => <p>{appFormat().dateTime(ts)}</p>;"],
    ["useFormat() directly", "const A = () => <p>{useFormat().minutes(m)}</p>;"],
    ["formatterFor()", 'const f = formatterFor("ko");\nconst A = () => <p>{f.number(n)}</p>;'],
    ["a destructured method", "const { tokens: tk } = useFormat();\nconst A = () => <p>{tk(n)}</p>;"],
    ["a module function", 'const A = () => <p>{formatBytes(b, "ko")}</p>;'],
    ["a const", "function A() {\n  const label = fmt.count(n);\n  return <p>{label}</p>;\n}"],
    ["a const of a const", "function A() {\n  const a = fmt.count(n);\n  const b = ok ? a : \"—\";\n  return <p>{b}</p>;\n}"],
    ["useMemo", "function A() {\n  const label = useMemo(() => fmt.dateTime(ts), [ts]);\n  return <p>{label}</p>;\n}"],
    ["a helper", "const elapsed = (ms: number) => fmt.duration(ms);\nconst A = () => <p>{elapsed(ms)}</p>;"],
    ["a function", "function stamp(ts: string) {\n  return fmt.time(ts);\n}\nconst A = () => <p>{stamp(ts)}</p>;"],
    ["map", "const A = () => <p>{items.map((i) => fmt.count(i))}</p>;"],
    ["a component that renders only the text", "const Total = () => fmt.count(n);"],
    ["a message that interpolates it", 'const A = () => <p>{t("k", { count: fmt.count(n) })}</p>;'],
    ["a message with a default text", 'const A = () => <p>{t("k", "{{n}} msgs", { n: fmt.count(n) })}</p>;'],
    ["a message held in a const", 'function A() {\n  const meta = i18n.t("k", { date: fmt.dateTime(ts) });\n  return <p>{meta}</p>;\n}'],
  ])("%s", (_, code) => {
    expect(bareLines(code).length, code).toBeGreaterThan(0);
  });

  it("reports each site on its own line, also across lines", () => {
    expect(bareLines("const A = () => (\n  <div>\n    <span>\n      {fmt.time(ts)}\n    </span>\n    {fmt.date(ts)}\n  </div>\n);")).toEqual([4, 6]);
    expect(bareLines("const A = () => <p>{`${fmt.tokens(a)} / ${fmt.tokens(b)}`}</p>;")).toEqual([1, 1]);
  });

  it("follows a helper exported by another file", () => {
    const utils = { path: "src/components/utils.ts", text: "export const clock = (ts: string) => appFormat().time(ts);\nexport function day(ts: string) { return appFormat().date(ts); }" };
    expect(bareLines('import { clock, day as d } from "./utils";\nconst A = () => <p>{clock(ts)} {d(ts)}</p>;', [utils])).toEqual([2, 2]);
    const viaAlias = { path: "src/lib/stamp.ts", text: "export const stamp = (ts: string) => appFormat().time(ts);" };
    expect(bareLines('import { stamp } from "@/lib/stamp";\nconst A = () => <p>{stamp(ts)}</p>;', [viaAlias])).toEqual([2]);
  });
});

describe("<Num> guard: not reported", () => {
  it.each([
    ["inside <Num>", "const A = () => <p><Num>{fmt.count(n)}</Num></p>;"],
    ["a branch inside <Num>", 'const A = () => <Num>{ok ? fmt.cost(c) : t("x")}</Num>;'],
    ["a const inside <Num>", "function A() {\n  const label = fmt.count(n);\n  return <Num>{label}</Num>;\n}"],
    ["attributes of a DOM element", "const A = () => <span title={fmt.dateTimeFull(ts)} aria-label={fmt.time(ts)}>x</span>;"],
    ["a const used as an attribute", "function A() {\n  const label = fmt.count(n);\n  return <p title={label}>x</p>;\n}"],
    ["a message as an attribute", 'const A = () => <p title={t("k", { count: fmt.count(n) })}>x</p>;'],
    ["a message as data", 'const preset = { name: t("k", { date: appFormat().date(now) }) };\nsave(t("k", { size: fmt.bytes(b) }));'],
    ["another call", "toast(fmt.bytes(b));"],
    ["SVG text, which never wraps", "const A = () => <svg><text>{fmt.dayKey(d)}</text><tspan>{fmt.count(n)}</tspan></svg>;"],
    ["not a formatter", "const A = () => <p>{timer.time(ts)}{fmt.language}</p>;"],
    ["change().direction", "const A = () => <p>{fmt.change(a, b).direction}</p>;"],
    ["a condition", 'const A = () => <p>{fmt.count(n) === "0" ? "none" : "some"}</p>;'],
    ["a helper used as an attribute", "const clock = (ts: string) => fmt.time(ts);\nconst A = () => <p title={clock(ts)}>x</p>;"],
  ])("%s", (_, code) => {
    expect(bareLines(code), code).toEqual([]);
  });
});

describe("<Num> guard: handoffs to a component or an object field are listed", () => {
  it("names the component prop or the field", () => {
    const scan = scanNum([
      {
        path: "src/components/Probe.tsx",
        text: [
          "const A = () => <MetricCard value={fmt.tokens(n)} />;",
          'const B = () => <ChartTooltip rows={[{ label: "a", value: fmt.count(n) }]} />;',
          "const items = [{ caption: fmt.relative(ts) }];",
          "const C = () => <ui.Row detail={ok ? fmt.cost(c) : undefined} />;",
        ].join("\n"),
      },
    ]);
    expect(scan.bare).toEqual([]);
    expect(scan.handoffs).toEqual([
      "src/components/Probe.tsx: ChartTooltip.rows",
      "src/components/Probe.tsx: MetricCard.value",
      "src/components/Probe.tsx: field caption",
      "src/components/Probe.tsx: ui.Row.detail",
    ]);
  });
});

describe("<Num> guard: a formatter function handed on is followed to where it renders", () => {
  it("a method passed as a prop: the receiver's call of it is a formatter result", () => {
    const scan = scanNum([
      { path: "src/components/Probe.tsx", text: "const A = () => <Child formatTimeAgo={fmt.relative} />;" },
      { path: "src/components/Child.tsx", text: "export const Child = ({ formatTimeAgo }) => (\n  <p>{formatTimeAgo(ts)}</p>\n);" },
    ]);
    expect(scan.bare).toEqual(["src/components/Child.tsx:2: <p>{formatTimeAgo(ts)}</p>"]);
    expect(scan.functionHandoffs).toEqual(["src/components/Probe.tsx: Child.formatTimeAgo"]);
    expect(scan.functionReceivers).toEqual({ formatTimeAgo: ["src/components/Child.tsx"] });
    expect(scan.untracked).toEqual([]);
  });

  it("through components that pass it on: a destructured method, a field of a memoized object, a renamed binding, props.x()", () => {
    const scan = scanNum([
      { path: "src/components/Tree.tsx", text: "const { relative } = useFormat();\nexport const Tree = () => <List formatTimeAgo={relative} />;" },
      {
        path: "src/components/List.tsx",
        text: [
          "export function List(props: Props) {",
          "  const data = useMemo(() => ({ formatTimeAgo: props.formatTimeAgo }), [props.formatTimeAgo]);",
          "  return <Row data={data} />;",
          "}",
          "const Row = ({ data }) => {",
          "  const { formatTimeAgo: ago } = data;",
          "  return <Item ago={ago} />;",
          "};",
        ].join("\n"),
      },
      { path: "src/components/Item.tsx", text: "export const Item = (props) => (\n  <span>{props.ago(ts)}</span>\n);" },
    ]);
    expect(scan.bare).toEqual(["src/components/Item.tsx:2: <span>{props.ago(ts)}</span>"]);
    expect(scan.functionHandoffs).toEqual([
      "src/components/List.tsx: Item.ago",
      "src/components/List.tsx: field formatTimeAgo",
      "src/components/Tree.tsx: List.formatTimeAgo",
    ]);
    expect(scan.functionReceivers).toEqual({ formatTimeAgo: ["src/components/List.tsx"], ago: ["src/components/Item.tsx"] });
    expect(scan.untracked).toEqual([]);
  });

  it.each([
    ["an alias", "const f = fmt.time;\nconst A = () => <p>{f(ts)}</p>;", [2]],
    ["map over a method", "const A = () => <p>{items.map(fmt.count)}</p>;", [1]],
    ["map over a module function", "const A = () => <p>{sizes.map(formatBytes)}</p>;", [1]],
  ])("%s, rendered bare", (_, code, lines) => {
    expect(bareLines(code), code).toEqual(lines);
  });

  it("not reported: the receiver renders it inside <Num>, or as an attribute", () => {
    const scan = scanNum([
      { path: "src/components/Probe.tsx", text: "const A = () => <Child formatTimeAgo={fmt.relative} />;" },
      { path: "src/components/Child.tsx", text: "export const Child = ({ formatTimeAgo }) => <p title={formatTimeAgo(ts)}><Num>{formatTimeAgo(ts)}</Num></p>;" },
    ]);
    expect(scan.bare).toEqual([]);
    expect(scan.functionHandoffs).toEqual(["src/components/Probe.tsx: Child.formatTimeAgo"]);
  });

  it("a hook's dependency list is no handoff", () => {
    const scan = scanNum([{ path: "src/components/Probe.tsx", text: "const x = useMemo(() => 1, [fmt.relative, formatBytes]);" }]);
    expect(scan.functionHandoffs).toEqual([]);
    expect(scan.untracked).toEqual([]);
  });

  it("a formatter function passed where it cannot be followed is reported", () => {
    const scan = scanNum([
      {
        path: "src/components/Probe.tsx",
        text: ["register(fmt.time);", "const A = () => <input data-format={fmt.time} />;", "const pick = () => fmt.time;", "let later = fmt.relative;"].join("\n"),
      },
    ]);
    expect(scan.untracked).toEqual([
      "src/components/Probe.tsx:1: register(fmt.time);",
      "src/components/Probe.tsx:2: const A = () => <input data-format={fmt.time} />;",
      "src/components/Probe.tsx:3: const pick = () => fmt.time;",
      "src/components/Probe.tsx:4: let later = fmt.relative;",
    ]);
  });
});

describe("formatter callback adapters", () => {
  it("does not taint unrelated or shadowing same-named parameters", () => {
    const scan = scanNum([{ path: "src/components/Probe.tsx", text: `
      export function adapt(value, format) {
        function label(format) { return <p>{format("plain label")}</p>; }
        return format(value);
      }
      function other(format) { return <p>{format("other label")}</p>; }
      const A = () => <Num>{adapt(n, fmt.tokens)}</Num>;
    ` }]);
    expect(scan.untracked).toEqual([]);
    expect(scan.bare).toEqual([]);
  });
  it.each([false, true])("follows a callback through a local/imported adapter (imported=%s)", (imported) => {
    const adapter = "export function adapt(value, format) { return value == null ? '—' : format(value); }";
    const files = imported
      ? [{ path: "src/lib/adapter.ts", text: adapter }, { path: "src/components/Probe.tsx", text: "import { adapt as display } from '@/lib/adapter'; const A = () => <p>{display(n, fmt.tokens)}</p>;" }]
      : [{ path: "src/components/Probe.tsx", text: adapter + " const A = () => <p>{adapt(n, fmt.tokens)}</p>;" }];
    const scan = scanNum(files);
    expect(scan.untracked).toEqual([]);
    expect(scan.bare.length).toBe(1);
    const wrapped = files.map((f) => ({ ...f, text: f.text.replace('<p>{', '<Num>{').replace('}</p>', '}</Num>') }));
    expect(scanNum(wrapped).bare).toEqual([]);
  });
});

describe("<Num> guard on the app", () => {
  it("scans the source tree", () => {
    expect(appSources().length).toBeGreaterThan(300);
  });

  it("no formatter result is rendered bare", () => {
    expect(scanApp().bare).toEqual([]);
  }, 30_000);

  it("every handoff to a component or an object field is listed (its receiver renders it through <Num>)", () => {
    expect(scanApp().handoffs).toEqual(HANDOFFS);
  }, 30_000);

  it("every formatter function handed to a component or a field is listed, and each is received in the app", () => {
    const scan = scanApp();
    expect(scan.functionHandoffs).toEqual(FUNCTION_HANDOFFS);
    expect(Object.keys(scan.functionReceivers).length).toBeGreaterThan(0);
    // A name nobody receives (a third-party component, a typo) could not be followed.
    expect(Object.entries(scan.functionReceivers).filter(([, files]) => files.length === 0)).toEqual([]);
  }, 30_000);

  it("no formatter function is passed where it cannot be followed", () => {
    expect(scanApp().untracked).toEqual([]);
  }, 30_000);

  it("each receiver renders the handed-over text inside <Num>", () => {
    const files = new Map(appSources().map((f) => [f.path, f]));
    const keys = new Set(HANDOFFS.map((h) => h.split(": ")[1]!));
    expect([...keys].sort()).toEqual(Object.keys(RECEIVERS).sort());
    for (const key of keys) {
      const [file, child] = RECEIVERS[key]!;
      const hosts = hostsOf(files.get(file)!, child);
      expect(hosts.length, `${key}: {${child}} in ${file}`).toBeGreaterThan(0);
      expect(hosts, `${key}: {${child}} in ${file}`).toEqual(hosts.map(() => "Num"));
    }
  });

  it("finds a receiver that renders the text bare (fixture)", () => {
    const receiver = { path: "src/components/X.tsx", text: "const X = ({ value }) => <div><span>{value}</span><Num>{ value }</Num></div>;" };
    expect(hostsOf(receiver, "value")).toEqual(["span", "Num"]);
  });
});
