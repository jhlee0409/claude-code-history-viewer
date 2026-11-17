/**
 * Static guard for D15 (plan T3): a screen is rendered through the view
 * registry and nowhere else.
 *
 * "Screens" are the value exports of `layouts/shell/screens.tsx` (the screen
 * bodies and their frames); "view bodies" are the components those screens
 * wrap (`VIEW_BODIES`). Over every production source it reports:
 *
 * - a value reference to the screens module (named, default, namespace,
 *   re-export, dynamic `import()`) outside the registry, or to a screen name
 *   from any module (so a re-export cannot launder one);
 * - a value reference to a view body outside the registry's screens and the
 *   body's own folder - by name from any module (barrels, aliases) or by
 *   default / namespace / dynamic import of its module;
 * - JSX of any of those references outside the registry's construction path;
 * - JSX of a screen, a view body, or the shell's `entry.component` /
 *   `entry.frame` under a view condition anywhere - an `if` branch, an early
 *   `if … return` before it, a `switch` on the view, `&&` / `||` / `??`, or a
 *   ternary. A view condition is an `is…View` flag, a comparison with `view`
 *   or `screen`, or a literal view name;
 * - a registry entry picked by a literal view (`VIEW_REGISTRY.board`), and a
 *   registry entry's `component` / `frame` read outside the shell.
 *
 * Syntactic, not type-checked: it does not follow a component through a
 * variable or a function it was passed to. It is the enforcement surface for
 * the shapes above, each held by a self-test in `viewRegistry.test.ts`.
 */
import path from "node:path";
import ts from "typescript";

export interface SourceText {
  /** Path relative to `src/`, with forward slashes. */
  rel: string;
  text: string;
}

/** The registry's screens: the only importer of the view bodies. */
const SCREENS = "layouts/shell/screens";
/** The registry: the only importer of the screens. */
const REGISTRY = "layouts/shell/viewRegistry";
/** The shell: the one reader of a registry entry's component and frame. */
const SHELL = "layouts/AppLayout";

/** Each view body's export names and the folder that implements it. */
const VIEW_BODIES: { names: string[]; home: string }[] = [
  { names: ["MessageViewer"], home: "components/MessageViewer" },
  { names: ["TokenStatsViewer"], home: "components/TokenStatsViewer" },
  { names: ["AnalyticsDashboard"], home: "components/AnalyticsDashboard" },
  { names: ["RecentEditsViewer"], home: "components/RecentEditsViewer" },
  { names: ["SettingsManager", "UnifiedSettingsManager"], home: "components/SettingsManager" },
  { names: ["SessionBoard"], home: "components/SessionBoard" },
  { names: ["ArchiveManager"], home: "components/ArchiveManager" },
];

const LOGICAL: readonly ts.SyntaxKind[] = [
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
];

const BODY_NAMES = new Set(VIEW_BODIES.flatMap((body) => body.names));

/** `components/Foo/index.tsx` -> `components/Foo`. */
const moduleIdOf = (rel: string) => rel.replace(/\.(d\.)?tsx?$/, "").replace(/\/index$/, "");

/** The module a specifier names, as a src-relative id; null for packages. */
function resolve(fromRel: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = specifier.slice(2);
  else if (specifier.startsWith(".")) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
  } else return null;
  return moduleIdOf(target);
}

const inHome = (id: string, home: string) => id === home || id.startsWith(`${home}/`);

/** The body whose folder `id` lies in, if any. */
const bodyHomeOf = (id: string) => VIEW_BODIES.find((body) => inHome(id, body.home));

/** A module that exports a view body itself (not a helper in its folder). */
function isBodyModule(id: string): boolean {
  const body = bodyHomeOf(id);
  return !!body && (id === body.home || BODY_NAMES.has(path.posix.basename(id)));
}

/** Names the screens module exports as values. */
function screenNames(files: SourceText[]): Set<string> {
  const screens = files.find((file) => moduleIdOf(file.rel) === SCREENS);
  const names = new Set<string>();
  if (!screens) return names;
  const source = parse(screens);
  for (const statement of source.statements) {
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function parse({ rel, text }: SourceText): ts.SourceFile {
  return ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

const unparen = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;

/** What a local binding refers to; `namespace` when it holds the whole module. */
interface Binding {
  /** The screen / body / registry field it stands for. */
  target: string;
  namespace: boolean;
  /** Whether this file may reference it at all. */
  allowed: boolean;
}

export function screenRenderViolations(
  files: SourceText[],
  views: readonly string[]
): string[] {
  const SCREEN_NAMES = screenNames(files);
  const quoted = views.join("|");
  const VIEW_CONDITION = new RegExp(
    [
      String.raw`\bis[A-Z]\w*View\b`,
      String.raw`\b(?:view|screen)\b\s*[!=]==?`,
      String.raw`[!=]==?\s*\b(?:view|screen)\b`,
      String.raw`["'\`](?:${quoted})["'\`]`,
    ].join("|")
  );
  const isViewCondition = (node: ts.Node, source: ts.SourceFile) =>
    VIEW_CONDITION.test(node.getText(source));

  const violations: string[] = [];

  for (const file of files) {
    const id = moduleIdOf(file.rel);
    const source = parse(file);
    const at = (node: ts.Node) =>
      `${file.rel}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const report = (node: ts.Node, message: string) => violations.push(`${at(node)} ${message}`);

    const mayUseScreens = id === REGISTRY || id === SCREENS;
    const mayUseBody = (name: string) =>
      id === SCREENS || VIEW_BODIES.some((body) => body.names.includes(name) && inHome(id, body.home));
    const mayUseBodyModule = (target: string) =>
      id === SCREENS || bodyHomeOf(target) === bodyHomeOf(id);

    /** Local name -> what it refers to, for the JSX checks. */
    const bindings = new Map<string, Binding>();
    if (id === SCREENS) {
      for (const name of SCREEN_NAMES) bindings.set(name, { target: name, namespace: false, allowed: true });
    }

    /**
     * One imported or re-exported value. `imported` is the exported name
     * (null for default / namespace / dynamic), `local` the name it binds.
     */
    const referenceTo = (
      node: ts.Node,
      specifier: string,
      imported: string | null,
      local: string | null
    ) => {
      const target = resolve(file.rel, specifier);
      const fromScreens = target === SCREENS;
      if (imported !== null && (SCREEN_NAMES.has(imported) || fromScreens)) {
        if (!mayUseScreens) report(node, `imports ${imported} from the screens module outside the registry`);
        if (local) bindings.set(local, { target: imported, namespace: false, allowed: mayUseScreens });
        return;
      }
      if (imported !== null && BODY_NAMES.has(imported)) {
        const allowed = mayUseBody(imported);
        if (!allowed) report(node, `imports ${imported} outside the registry's screens`);
        if (local) bindings.set(local, { target: imported, namespace: false, allowed });
        return;
      }
      if (imported !== null || target === null) return;
      if (fromScreens) {
        if (!mayUseScreens) report(node, "imports * from the screens module outside the registry");
        if (local) bindings.set(local, { target: "*", namespace: true, allowed: mayUseScreens });
      } else if (isBodyModule(target)) {
        const allowed = mayUseBodyModule(target);
        if (!allowed) report(node, `imports * from ${target} outside the registry's screens`);
        if (local) bindings.set(local, { target: "*", namespace: true, allowed });
      }
    };

    let importsRegistry = false;

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue;
        if (clause.name) referenceTo(statement, specifier, null, clause.name.text);
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) {
          referenceTo(statement, specifier, null, named.name.text);
        } else if (named) {
          for (const element of named.elements) {
            if (element.isTypeOnly) continue;
            const imported = (element.propertyName ?? element.name).text;
            if (imported === "VIEW_REGISTRY") importsRegistry = true;
            referenceTo(element, specifier, imported, element.name.text);
          }
        }
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        if (statement.isTypeOnly) continue;
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
        const clause = statement.exportClause;
        if (!clause || ts.isNamespaceExport(clause)) {
          referenceTo(statement, specifier, null, null);
        } else {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            referenceTo(element, specifier, (element.propertyName ?? element.name).text, null);
          }
        }
      }
    }

    const readsEntryComponent = id !== REGISTRY && id !== SHELL && importsRegistry;

    // Dynamic imports, registry reads, and the shell's entry.component locals.
    const scan = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        referenceTo(node, node.arguments[0].text, null, null);
      }
      if (id !== REGISTRY && ts.isIdentifier(node) && node.text === "VIEW_REGISTRY") {
        const parent = node.parent;
        const literal =
          ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? parent.name.text
            : ts.isElementAccessExpression(parent) &&
                parent.expression === node &&
                ts.isStringLiteralLike(parent.argumentExpression)
              ? parent.argumentExpression.text
              : null;
        if (literal !== null && views.includes(literal)) {
          report(parent, `picks VIEW_REGISTRY.${literal} by a literal view`);
        }
      }
      const field = /^(?:component|frame)$/;
      if (
        readsEntryComponent &&
        ((ts.isPropertyAccessExpression(node) && field.test(node.name.text)) ||
          (ts.isBindingElement(node) && field.test((node.propertyName ?? node.name).getText(source))))
      ) {
        report(node, "reads a registry entry's component outside the shell");
      }
      if (
        (id === SHELL || readsEntryComponent) &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isPropertyAccessExpression(unparen(node.initializer)) &&
        field.test((unparen(node.initializer) as ts.PropertyAccessExpression).name.text)
      ) {
        const name = (unparen(node.initializer) as ts.PropertyAccessExpression).name.text;
        bindings.set(node.name.text, {
          target: `entry.${name}`,
          namespace: false,
          allowed: id === SHELL,
        });
      }
      ts.forEachChild(node, scan);
    };
    scan(source);

    /** The binding a JSX tag renders, and its printable target. */
    const renderedBy = (tag: ts.JsxTagNameExpression): [Binding, string] | null => {
      if (ts.isIdentifier(tag)) {
        const binding = bindings.get(tag.text);
        return binding && !binding.namespace ? [binding, binding.target] : null;
      }
      if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression)) {
        const binding = bindings.get(tag.expression.text);
        return binding?.namespace ? [binding, tag.name.text] : null;
      }
      return null;
    };

    /** The view condition `node` renders under, if any. */
    const viewConditionOf = (node: ts.Node): string | null => {
      let child: ts.Node = node;
      for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
        if (
          ts.isIfStatement(parent) &&
          child !== parent.expression &&
          isViewCondition(parent.expression, source)
        ) {
          return parent.expression.getText(source);
        }
        if (
          ts.isConditionalExpression(parent) &&
          child !== parent.condition &&
          isViewCondition(parent.condition, source)
        ) {
          return parent.condition.getText(source);
        }
        if (
          ts.isBinaryExpression(parent) &&
          child === parent.right &&
          LOGICAL.includes(parent.operatorToken.kind) &&
          isViewCondition(parent.left, source)
        ) {
          return parent.left.getText(source);
        }
        if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
          const switchStatement = parent.parent.parent;
          const labels = switchStatement.caseBlock.clauses.filter(ts.isCaseClause);
          if (
            isViewCondition(switchStatement.expression, source) ||
            labels.some((clause) => isViewCondition(clause.expression, source))
          ) {
            return `switch (${switchStatement.expression.getText(source)})`;
          }
        }
        // An earlier `if (<view condition>) return …` in an enclosing block.
        if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent)) {
          for (const statement of parent.statements) {
            if (statement === child) break;
            if (
              ts.isIfStatement(statement) &&
              isViewCondition(statement.expression, source) &&
              exits(statement)
            ) {
              return statement.expression.getText(source);
            }
          }
        }
      }
      return null;
    };

    const visitJsx = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const rendered = renderedBy(node.tagName);
        if (rendered) {
          const [binding, target] = rendered;
          const tag = node.tagName.getText(source);
          if (!binding.allowed) report(node, `renders <${tag}> (${target}) outside the registry`);
          const condition = viewConditionOf(node);
          if (condition !== null) {
            report(node, `renders <${tag}> (${target}) under a view condition: ${condition}`);
          }
        }
      }
      ts.forEachChild(node, visitJsx);
    };
    visitJsx(source);
  }

  return violations;
}

/** Whether an `if` leaves its block in some branch (`return` / `throw`). */
function exits(statement: ts.IfStatement): boolean {
  const leaves = (node: ts.Node): boolean =>
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    (!ts.isFunctionLike(node) && (ts.forEachChild(node, leaves) ?? false));
  return leaves(statement.thenStatement) || (!!statement.elseStatement && leaves(statement.elseStatement));
}
