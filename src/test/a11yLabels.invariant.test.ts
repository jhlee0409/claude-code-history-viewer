/**
 * Accessible-name invariants for app components (src/**\/*.tsx, tests
 * excluded), checked on the syntax tree:
 *
 * - An icon-only `<button>` / `<Button>` - one whose children can never
 *   render text, only elements without text (icons) - names itself with
 *   `aria-label` or `aria-labelledby`. A `title` alone is a hover tooltip,
 *   not the button's name in every screen reader.
 * - `title` and `aria-label` are never literal English: they are
 *   user-visible (tooltip) or read aloud, so they go through `t()`. The
 *   exceptions are names that are the same in every language (tool names,
 *   keyboard keys), listed in LITERAL_ALLOWED.
 *
 * A child counts as text when it is non-blank JSX text, or an expression that
 * is not plainly JSX (a `t()` call, a variable, a template). Conditionals and
 * `&&` count as text when any branch does. Buttons that spread props or use
 * `asChild` are skipped: their name comes from elsewhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

/** Literal title / aria-label values that are the same in every language. */
const LITERAL_ALLOWED: Record<string, string> = {
  Glob: "tool name",
  Grep: "tool name",
  Read: "tool name",
  Write: "tool name",
  WebFetch: "tool name",
  WebSearch: "tool name",
  Enter: "keyboard key",
  "Shift+Enter": "keyboard key",
};

function appTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" || entry.name === "__tests__" ? [] : appTsxFiles(path);
    }
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

const BUTTON_TAGS = new Set(["button", "Button"]);

function attributeNames(attributes: ts.JsxAttributes): Set<string> | "spread" {
  const names = new Set<string>();
  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) return "spread";
    names.add(property.name.getText());
  }
  return names;
}

function expressionRendersText(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) return expressionRendersText(expression.expression);
  if (ts.isJsxElement(expression) || ts.isJsxFragment(expression)) return childrenRenderText(expression.children);
  if (ts.isJsxSelfClosingElement(expression)) return false;
  if (ts.isConditionalExpression(expression)) {
    return expressionRendersText(expression.whenTrue) || expressionRendersText(expression.whenFalse);
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return expressionRendersText(expression.right);
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword) return false;
  return true;
}

function childrenRenderText(children: ts.NodeArray<ts.JsxChild>): boolean {
  return children.some((child) => {
    if (ts.isJsxText(child)) return child.text.trim() !== "";
    if (ts.isJsxExpression(child)) return child.expression ? expressionRendersText(child.expression) : false;
    if (ts.isJsxElement(child) || ts.isJsxFragment(child)) return childrenRenderText(child.children);
    return false;
  });
}

interface Findings {
  unnamedIconButtons: string[];
  literalLabels: string[];
}

function scan(): Findings {
  const findings: Findings = { unnamedIconButtons: [], literalLabels: [] };
  for (const file of appTsxFiles(SRC)) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const where = (node: ts.Node) =>
      `${relative(ROOT, file).split(sep).join("/")}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    const visit = (node: ts.Node) => {
      if (
        ts.isJsxAttribute(node) &&
        ["title", "aria-label"].includes(node.name.getText()) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[A-Za-z]{2,}/.test(node.initializer.text) &&
        !(node.initializer.text in LITERAL_ALLOWED)
      ) {
        findings.literalLabels.push(`${where(node)} ${node.name.getText()}="${node.initializer.text}"`);
      }
      if (ts.isJsxElement(node) && BUTTON_TAGS.has(node.openingElement.tagName.getText())) {
        const names = attributeNames(node.openingElement.attributes);
        const named = names === "spread" || names.has("aria-label") || names.has("aria-labelledby") || names.has("asChild");
        if (!named && !childrenRenderText(node.children)) {
          findings.unnamedIconButtons.push(`${where(node)} <${node.openingElement.tagName.getText()}>`);
        }
      }
      if (ts.isJsxSelfClosingElement(node) && BUTTON_TAGS.has(node.tagName.getText())) {
        const names = attributeNames(node.attributes);
        const named = names === "spread" || names.has("aria-label") || names.has("aria-labelledby") || names.has("children");
        if (!named) findings.unnamedIconButtons.push(`${where(node)} <${node.tagName.getText()} />`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

describe("accessible names", () => {
  const findings = scan();

  it("names every icon-only button with aria-label", () => {
    expect(findings.unnamedIconButtons.join("\n")).toBe("");
  });

  it("translates every title and aria-label", () => {
    expect(findings.literalLabels.join("\n")).toBe("");
  });
});
