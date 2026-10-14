/**
 * Static map of the writes that land after an `await` (plan §4.2), for the
 * async-ownership invariant and the T2 inventory (`scratch/t2/async-writes.md`).
 *
 * A write is "after an await" when an `await` precedes it in the same
 * function, or when it sits in a `.then` / `.catch` / `.finally` callback.
 * It is "gated" when an ownership predicate (`owns…()`, `isStale…()`, …)
 * guards it: an enclosing `if` whose condition calls one, a `&&` chain that
 * does, or an earlier `if (…) return` in an enclosing block.
 */
import ts from "typescript";

export type WriteKind =
  | "toast"
  | "alert"
  | "global-error"
  | "screen-error"
  | "spinner"
  | "url"
  | "target"
  | "place"
  | "data";

/** Kinds that show something outside the screen that asked for it. */
export const FEEDBACK_KINDS: readonly WriteKind[] = [
  "toast",
  "alert",
  "global-error",
  "url",
  "target",
  "place",
];

export interface AsyncWrite {
  line: number;
  fn: string;
  kinds: WriteKind[];
  callee: string;
  /** Guard conditions found between the write and its function. */
  guards: string[];
  inFinally: boolean;
  gated: boolean;
}

/**
 * Place-ownership predicates: a call to one of these gates feedback.
 * (`ownsData` / `isLatest` alone do not: they say nothing about navigation.)
 */
const GATE = /\b(?:ownsFeedback|ownsPlace|owns|isStale\w*)\s*\(/;
/** Results of an owned call (`navigate` resolves whether it still owned). */
const GATE_VALUE = /^!?\s*(?:restored|arrived)\b/;

const isGateText = (text: string) => GATE.test(text) || GATE_VALUE.test(text.trim());

const PLACE_FIELDS = /^(view|selectedProject|selectedSession|navigationEpoch|placeHistory)$/;
const TARGET_FIELDS = /^(targetMessageUuid|shouldHighlightTarget)$/;

function functionName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      (ts.isPropertyAssignment(current) || ts.isMethodDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    current = current.parent;
  }
  return "<module>";
}

const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent;
  while (current && !isFunctionLike(current)) current = current.parent;
  return current;
}

/** A callback handed to `.then` / `.catch` / `.finally` runs after an await. */
function isPromiseCallback(fn: ts.FunctionLikeDeclaration): boolean {
  const call = fn.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    /^(then|catch|finally)$/.test(call.expression.name.text)
  );
}

function awaitsBefore(fn: ts.FunctionLikeDeclaration, position: number): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || node.pos >= position) return;
    if (node !== fn && isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node) && node.end <= position) {
      found = true;
      return;
    }
    // A for-await loop also awaits.
    if (ts.isForOfStatement(node) && node.awaitModifier && node.pos < position) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

/** The object literal(s) a `set(...)` call writes. */
function setObjects(call: ts.CallExpression): ts.ObjectLiteralExpression[] {
  const arg = call.arguments[0];
  if (!arg) return [];
  if (ts.isObjectLiteralExpression(arg)) return [arg];
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const body = arg.body;
    const out: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isParenthesizedExpression(node)) return visit(node.expression);
      if (ts.isObjectLiteralExpression(node)) out.push(node);
      if (ts.isReturnStatement(node) && node.expression) visit(node.expression);
      if (ts.isBlock(node) || ts.isIfStatement(node)) ts.forEachChild(node, visit);
    };
    visit(body);
    return out;
  }
  return [];
}

const isNullish = (node: ts.Expression | undefined) =>
  !node ||
  node.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isIdentifier(node) && node.text === "undefined");

function kindsOfSetObject(object: ts.ObjectLiteralExpression, nested: boolean): WriteKind[] {
  const kinds = new Set<WriteKind>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      if (ts.isSpreadAssignment(property)) continue;
      continue;
    }
    const name = property.name.getText();
    const value = ts.isPropertyAssignment(property) ? property.initializer : undefined;
    if (/^error$/.test(name) && !nested) {
      if (!isNullish(value)) kinds.add("global-error");
    } else if (/error$/i.test(name)) {
      if (!isNullish(value)) kinds.add("screen-error");
    } else if (/^isLoading|^isRefreshing|^isCreating|^isDeleting|^isRenaming|^isExporting|^isDetecting|^isSearching/.test(name)) {
      kinds.add("spinner");
    } else if (PLACE_FIELDS.test(name)) {
      kinds.add("place");
    } else if (TARGET_FIELDS.test(name)) {
      kinds.add("target");
    } else if (value && ts.isObjectLiteralExpression(value)) {
      for (const kind of kindsOfSetObject(value, true)) kinds.add(kind);
      kinds.add("data");
    } else {
      kinds.add("data");
    }
  }
  return [...kinds];
}

function classify(call: ts.CallExpression): { kinds: WriteKind[]; callee: string } | null {
  const callee = call.expression.getText();
  const name = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : "";
  const firstArg = call.arguments[0];

  if (/^toast\.\w+$/.test(callee)) return { kinds: ["toast"], callee };
  if (callee === "window.alert" || callee === "alert") return { kinds: ["alert"], callee };
  if (name === "setError") {
    return isNullish(firstArg) ? null : { kinds: ["global-error"], callee };
  }
  if (name === "writeWebUIDeepLink") return { kinds: ["url"], callee };
  if (name === "navigateToMessage" || name === "clearTargetMessage") {
    return { kinds: ["target"], callee };
  }
  if (/^(navigate|clearProjectSelection|setSelectedSession)$/.test(name)) {
    return { kinds: ["place"], callee };
  }
  if (/^set\w*Error$/.test(name)) {
    return isNullish(firstArg) ? { kinds: ["data"], callee } : { kinds: ["screen-error"], callee };
  }
  if (/^set\w*Loading\w*$/.test(name)) return { kinds: ["spinner"], callee };
  if (callee === "set") {
    const kinds = new Set<WriteKind>();
    for (const object of setObjects(call)) {
      for (const kind of kindsOfSetObject(object, false)) kinds.add(kind);
    }
    return { kinds: kinds.size ? [...kinds] : ["data"], callee };
  }
  // A store action writing data (`get().setAnalytics…`, `useAppStore.getState().setDateFilter`).
  if (/^set[A-Z]\w*$/.test(name) && /get\(\)|getState\(\)|^set[A-Z]/.test(callee)) {
    return { kinds: ["data"], callee };
  }
  return null;
}

/** Guards between `node` and its function: conditions that protect it. */
function guardsOf(node: ts.Node, fn: ts.FunctionLikeDeclaration): { guards: string[]; inFinally: boolean } {
  const guards: string[] = [];
  let inFinally = false;
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current && current !== fn) {
    if (ts.isIfStatement(current) && child === current.thenStatement) {
      guards.push(current.expression.getText());
    }
    if (ts.isConditionalExpression(current) && child !== current.condition) {
      guards.push(current.condition.getText());
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      child === current.right
    ) {
      guards.push(current.left.getText());
    }
    if (ts.isTryStatement(current) && child === current.finallyBlock) inFinally = true;
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isCaseClause(current)) {
      const statements = (current as ts.Block).statements;
      for (const statement of statements) {
        if (statement === child) break;
        if (
          ts.isIfStatement(statement) &&
          exits(statement.thenStatement)
        ) {
          guards.push(statement.expression.getText());
        }
      }
    }
    child = current;
    current = current.parent;
  }
  return { guards, inFinally };
}

function exits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
    return true;
  }
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && exits(last);
  }
  return false;
}

/** Every write after an await in `source`. */
export function asyncWrites(fileName: string, source: string): AsyncWrite[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const writes: AsyncWrite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const kind = classify(node);
      const fn = kind && enclosingFunction(node);
      if (kind && fn && (isPromiseCallback(fn) || awaitsBefore(fn, node.getStart()))) {
        const { guards, inFinally } = guardsOf(node, fn);
        writes.push({
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          fn: functionName(fn),
          kinds: kind.kinds,
          callee: kind.callee,
          guards,
          inFinally,
          gated: guards.some(isGateText),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return writes;
}

export const isFeedback = (write: AsyncWrite) =>
  write.kinds.some((kind) => FEEDBACK_KINDS.includes(kind));
