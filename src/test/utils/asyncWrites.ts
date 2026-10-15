/**
 * Static map of the writes that land after an `await` (plan §4.2), for the
 * async-ownership invariant and the T2 inventory (`scratch/t2/async-writes.md`).
 *
 * A write is "after an await" when an `await` precedes it in its function -
 * or in a function it is an inline callback of (`items.forEach(() => …)`) -
 * or when it sits in a `.then` / `.catch` / `.finally` callback.
 *
 * It is "gated" when an ownership check DOMINATES it: the write runs only
 * once the check has said the work is still owned, and no `await` lies
 * between the check and the write. With `P` an ownership predicate
 * (`ownsFeedback()`, `ownsPlace()`, `owns()`, or an owned result `restored` /
 * `arrived`) and `S` a staleness predicate (`isStale…()`), accepted shapes:
 *
 * - `if (P) write`, `if (S) … else write`, `P && write`, `S || write`,
 *   `P ? write : …`;
 * - an earlier `if (!P) return;` / `if (S) return;` (or `throw`, `break`,
 *   `continue`) in an enclosing block;
 * - conditions combine soundly: `P && x` proves ownership, `P || x` does not,
 *   and `!P` only on the branch where it is false.
 *
 * Anything else - an inverted check, a write in the branch where ownership
 * was refused, a check followed by another `await` - is not gated.
 *
 * Writes it recognises: `toast.*` (and local aliases of `toast` or its
 * methods), `alert`, `setError`, `writeWebUIDeepLink`, the target / place
 * actions, and the slice's `set(...)` / any store's `.setState(...)` - with
 * object literals, updater returns, local `const` objects and their spreads.
 * A store write whose object it cannot see is `opaque`, which counts as
 * feedback: the scan refuses what it cannot check instead of passing it.
 *
 * Not followed: calls into other functions, objects built outside the
 * enclosing functions. Data identity and spinner ownership are not checked
 * here at all - they need behavioural tests.
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
  | "opaque"
  | "data";

/** Kinds that show something outside the screen that asked for it. */
export const FEEDBACK_KINDS: readonly WriteKind[] = [
  "toast",
  "alert",
  "global-error",
  "url",
  "target",
  "place",
  "opaque",
];

export interface AsyncWrite {
  line: number;
  fn: string;
  kinds: WriteKind[];
  callee: string;
  /** Conditions found between the write and its function, any polarity. */
  guards: string[];
  inFinally: boolean;
  /** An ownership check dominates the write, with no await in between. */
  gated: boolean;
}

/**
 * Place-ownership predicates. (`ownsData` / `isLatest` alone do not gate
 * feedback: they say nothing about navigation.)
 */
const OWNED_CALL = /^(?:ownsFeedback|ownsPlace|owns)$/;
/** True means the work no longer owns the place. */
const STALE_CALL = /^isStale\w*$/;
/** Results of an owned call (`navigate` resolves whether it still owned). */
const OWNED_VALUE = /^(?:restored|arrived)$/;

const PLACE_FIELDS = /^(view|selectedProject|selectedSession|navigationEpoch|placeHistory)$/;
const TARGET_FIELDS = /^(targetMessageUuid|shouldHighlightTarget)$/;
const PLACE_ACTIONS = /^(navigate|clearProjectSelection|setSelectedSession)$/;
const SPINNER_FIELDS =
  /^isLoading|^isRefreshing|^isCreating|^isDeleting|^isRenaming|^isExporting|^isDetecting|^isSearching/;

const calleeName = (call: ts.CallExpression): string =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : ts.isIdentifier(call.expression)
      ? call.expression.text
      : "";

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

/**
 * Whether `condition` evaluating to `truth` proves the work still owns the
 * place. Sound for `!`, `&&`, `||` and parentheses; anything else proves
 * nothing.
 */
function ownedWhen(condition: ts.Expression, truth: boolean): boolean {
  const node = unwrap(condition);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return ownedWhen(node.operand, !truth);
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node);
    if (OWNED_CALL.test(name)) return truth;
    if (STALE_CALL.test(name)) return !truth;
    return false;
  }
  if (ts.isIdentifier(node) && OWNED_VALUE.test(node.text)) return truth;
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      return truth
        ? ownedWhen(node.left, true) || ownedWhen(node.right, true)
        : ownedWhen(node.left, false) && ownedWhen(node.right, false);
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      return truth
        ? ownedWhen(node.left, true) && ownedWhen(node.right, true)
        : ownedWhen(node.left, false) || ownedWhen(node.right, false);
    }
  }
  return false;
}

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

/** A function passed straight to another call (`forEach`, `map`, …). */
function isInlineCallback(fn: ts.FunctionLikeDeclaration): boolean {
  const call = fn.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((arg) => arg === fn) &&
    !isPromiseCallback(fn)
  );
}

/**
 * The functions a write runs in, innermost first. An inline callback is
 * part of the function that calls it; a promise callback or any other
 * function ends the chain.
 */
function functionChain(node: ts.Node): ts.FunctionLikeDeclaration[] {
  const chain: ts.FunctionLikeDeclaration[] = [];
  let fn = enclosingFunction(node);
  while (fn) {
    chain.push(fn);
    if (!isInlineCallback(fn)) break;
    fn = enclosingFunction(fn);
  }
  return chain;
}

/**
 * An await in `fn`'s own body (not a nested function's) within [from, to)
 * that can run before the code at `to`: a branch that `to` is not in is
 * skipped when it is the other arm of `to`'s branch, or when it exits.
 */
function awaitsIn(fn: ts.FunctionLikeDeclaration, from: number, to: number): boolean {
  let found = false;
  const contains = (node: ts.Node | undefined) =>
    node !== undefined && node.getStart() <= to && to < node.end;
  const visit = (node: ts.Node) => {
    if (found || node.pos >= to || node.end <= from) return;
    if (node !== fn && isFunctionLike(node)) return;
    if (ts.isIfStatement(node)) {
      visit(node.expression);
      for (const branch of [node.thenStatement, node.elseStatement]) {
        if (!branch) continue;
        const otherArm = contains(node) && !contains(branch);
        if (!otherArm && (contains(branch) || !exits(branch))) visit(branch);
      }
      return;
    }
    const start = node.getStart();
    if (ts.isAwaitExpression(node) && start >= from && node.end <= to) {
      found = true;
      return;
    }
    // A for-await loop also awaits.
    if (ts.isForOfStatement(node) && node.awaitModifier && start >= from && start < to) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

const awaitsBetween = (chain: ts.FunctionLikeDeclaration[], from: number, to: number) =>
  chain.some((fn) => awaitsIn(fn, from, to));

const isNullish = (node: ts.Expression | undefined) =>
  !node ||
  node.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isIdentifier(node) && node.text === "undefined");

/** The initializer of a `const` / `let` named `name` declared before `from`. */
function localInitializer(name: string, from: ts.Node): ts.Expression | undefined {
  let scope: ts.Node | undefined = from.parent;
  while (scope) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isCaseClause(scope)) {
      for (const statement of scope.statements) {
        if (statement.pos >= from.pos) break;
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
            return declaration.initializer;
          }
        }
      }
    }
    scope = scope.parent;
  }
  return undefined;
}

/** The objects a store write writes; `null` when one of them cannot be seen. */
function writtenObjects(
  arg: ts.Expression | undefined,
  at: ts.Node,
): ts.ObjectLiteralExpression[] | null {
  if (!arg) return [];
  const node = unwrap(arg);
  if (isNullish(node)) return [];
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isIdentifier(node)) {
    const init = localInitializer(node.text, at);
    return init ? writtenObjects(init, at) : null;
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = writtenObjects(node.whenTrue, at);
    const whenFalse = writtenObjects(node.whenFalse, at);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (!ts.isBlock(node.body)) return writtenObjects(node.body, at);
    const out: ts.ObjectLiteralExpression[] = [];
    let opaque = false;
    // `return state` hands the store its own state back: no write.
    const params = new Set(
      node.parameters.flatMap((p) => (ts.isIdentifier(p.name) ? [p.name.text] : [])),
    );
    const visit = (child: ts.Node) => {
      if (child !== node.body && isFunctionLike(child)) return;
      if (ts.isReturnStatement(child)) {
        const value = child.expression && unwrap(child.expression);
        if (value && ts.isIdentifier(value) && params.has(value.text)) return;
        const objects = writtenObjects(child.expression, child);
        if (objects) out.push(...objects);
        else opaque = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node.body);
    return opaque ? null : out;
  }
  return null;
}

function addKindsOfObject(
  object: ts.ObjectLiteralExpression,
  nested: boolean,
  kinds: Set<WriteKind>,
): void {
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const objects = writtenObjects(property.expression, property);
      // Inside a field, what a spread copies is that field's own data.
      if (!objects) kinds.add(nested ? "data" : "opaque");
      for (const spread of objects ?? []) addKindsOfObject(spread, nested, kinds);
      continue;
    }
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const name = property.name.getText();
    // A shorthand `{ error }` writes a value the scan cannot see: not cleared.
    const value = ts.isPropertyAssignment(property)
      ? unwrap(property.initializer)
      : undefined;
    const sets = value === undefined || !isNullish(value);
    if (/^error$/.test(name) && !nested) {
      if (sets) kinds.add("global-error");
    } else if (/error$/i.test(name)) {
      if (sets) kinds.add("screen-error");
    } else if (SPINNER_FIELDS.test(name)) {
      kinds.add("spinner");
    } else if (PLACE_FIELDS.test(name)) {
      kinds.add("place");
    } else if (TARGET_FIELDS.test(name)) {
      kinds.add("target");
    } else if (value && ts.isObjectLiteralExpression(value)) {
      addKindsOfObject(value, true, kinds);
      kinds.add("data");
    } else {
      kinds.add("data");
    }
  }
}

interface ToastAliases {
  /** Names bound to the `toast` object. */
  objects: Set<string>;
  /** Names bound to one of its methods. */
  methods: Set<string>;
}

function toastAliases(file: ts.SourceFile): ToastAliases {
  const aliases: ToastAliases = { objects: new Set(["toast"]), methods: new Set() };
  const isToast = (node: ts.Expression) =>
    ts.isIdentifier(node) && aliases.objects.has(node.text);
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isIdentifier(node.name)) {
        if (isToast(init)) aliases.objects.add(node.name.text);
        if (ts.isPropertyAccessExpression(init) && isToast(init.expression)) {
          aliases.methods.add(node.name.text);
        }
      } else if (ts.isObjectBindingPattern(node.name) && isToast(init)) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) aliases.methods.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return aliases;
}

function classify(
  call: ts.CallExpression,
  aliases: ToastAliases,
): { kinds: WriteKind[]; callee: string } | null {
  const expression = call.expression;
  const callee = expression.getText();
  const name = calleeName(call);
  const firstArg = call.arguments[0];

  if (
    (ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      aliases.objects.has(expression.expression.text)) ||
    (ts.isIdentifier(expression) && aliases.methods.has(expression.text))
  ) {
    return { kinds: ["toast"], callee };
  }
  if (callee === "window.alert" || callee === "alert") return { kinds: ["alert"], callee };
  if (name === "setError") {
    return isNullish(firstArg) ? null : { kinds: ["global-error"], callee };
  }
  if (name === "writeWebUIDeepLink") return { kinds: ["url"], callee };
  if (name === "navigateToMessage" || name === "clearTargetMessage") {
    return { kinds: ["target"], callee };
  }
  if (PLACE_ACTIONS.test(name)) return { kinds: ["place"], callee };
  if (/^set\w*Error$/.test(name)) {
    return isNullish(firstArg) ? { kinds: ["data"], callee } : { kinds: ["screen-error"], callee };
  }
  if (/^set\w*Loading\w*$/.test(name)) return { kinds: ["spinner"], callee };
  // The slice's `set(...)`, and any store's `setState(...)`.
  if (callee === "set" || name === "setState") {
    const kinds = new Set<WriteKind>();
    const objects = writtenObjects(firstArg, call);
    if (!objects) kinds.add("opaque");
    for (const object of objects ?? []) addKindsOfObject(object, false, kinds);
    return { kinds: kinds.size ? [...kinds] : ["data"], callee };
  }
  // A store action writing data (`get().setAnalytics…`, `useAppStore.getState().setDateFilter`).
  if (/^set[A-Z]\w*$/.test(name) && /get\(\)|getState\(\)|^set[A-Z]/.test(callee)) {
    return { kinds: ["data"], callee };
  }
  return null;
}

function exits(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return true;
  }
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && exits(last);
  }
  return false;
}

interface Guard {
  text: string;
  /** Proves ownership where the write runs. */
  owned: boolean;
}

/** The conditions between `node` and the outermost function of its chain. */
function guardsOf(
  node: ts.Node,
  chain: ts.FunctionLikeDeclaration[],
): { guards: Guard[]; inFinally: boolean } {
  const outer = chain[chain.length - 1];
  const at = node.getStart();
  const guards: Guard[] = [];
  let inFinally = false;
  const guard = (condition: ts.Expression, truth: boolean) =>
    guards.push({
      text: condition.getText(),
      owned: ownedWhen(condition, truth) && !awaitsBetween(chain, condition.end, at),
    });
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current && current !== outer) {
    if (ts.isIfStatement(current)) {
      if (child === current.thenStatement) guard(current.expression, true);
      if (child === current.elseStatement) guard(current.expression, false);
    }
    if (ts.isConditionalExpression(current)) {
      if (child === current.whenTrue) guard(current.condition, true);
      if (child === current.whenFalse) guard(current.condition, false);
    }
    if (ts.isBinaryExpression(current) && child === current.right) {
      const op = current.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) guard(current.left, true);
      if (op === ts.SyntaxKind.BarBarToken) guard(current.left, false);
    }
    if (ts.isTryStatement(current) && child === current.finallyBlock) inFinally = true;
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isCaseClause(current)) {
      for (const statement of current.statements) {
        if (statement === child) break;
        if (!ts.isIfStatement(statement)) continue;
        // `if (C) exit;` falls through only when C was false;
        // `if (C) … else exit;` only when it was true.
        if (exits(statement.thenStatement)) guard(statement.expression, false);
        else if (statement.elseStatement && exits(statement.elseStatement)) {
          guard(statement.expression, true);
        }
      }
    }
    child = current;
    current = current.parent;
  }
  return { guards, inFinally };
}

/** Every write after an await in `source`. */
export function asyncWrites(fileName: string, source: string): AsyncWrite[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const aliases = toastAliases(file);
  const writes: AsyncWrite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const kind = classify(node, aliases);
      const chain = kind ? functionChain(node) : [];
      const at = node.getStart();
      const late =
        chain.length > 0 &&
        (isPromiseCallback(chain[chain.length - 1]) ||
          chain.some((fn) => awaitsIn(fn, fn.getStart(), at)));
      if (kind && late) {
        const { guards, inFinally } = guardsOf(node, chain);
        writes.push({
          line: file.getLineAndCharacterOfPosition(at).line + 1,
          fn: functionName(chain[0]),
          kinds: kind.kinds,
          callee: kind.callee,
          guards: guards.map((g) => g.text),
          inFinally,
          gated: guards.some((g) => g.owned),
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

/**
 * A write straight to a zustand store (`useAppStore.setState(...)`,
 * `useAppStore.getState().setError(...)`), as opposed to a component's own
 * React state setter of the same name.
 */
export const isStoreWrite = (write: AsyncWrite) =>
  /^\w*Store\.(?:setState$|getState\(\)\.)/.test(write.callee);
