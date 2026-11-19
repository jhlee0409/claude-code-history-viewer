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
 * - A `<SelectTrigger>` (a combobox) has an accessible name: `aria-label` /
 *   `aria-labelledby`, an `id` that a `<label htmlFor>` / `<Label htmlFor>`
 *   in the same file points at, or a `<Field label=…>` around it (the
 *   Field wires its label to the trigger). A placeholder is not a name
 *   (inner-UI plan F2a, G-SR4).
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

// ---------------------------------------------------------------------------
// Select triggers (comboboxes) need a name
// ---------------------------------------------------------------------------

const LABEL_TAGS = new Set(["label", "Label"]);

/** The attribute `name` of a JSX opening/self-closing element, or undefined. */
function attribute(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}

/** The initializer of an attribute as comparable text (`"x"` → x, `{selectId}` → selectId). */
function attributeValue(attr: ts.JsxAttribute | undefined): string | null {
  const init = attr?.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : e.getText();
  }
  return null;
}

/** Is an attribute present with a value that can name something (not `""`)? */
const hasName = (attr: ts.JsxAttribute | undefined) => !!attr && attributeValue(attr) !== "";

/**
 * `<SelectTrigger>` elements of one TSX source without an accessible name
 * (see the file header), as `file:line`.
 *
 * Limit of a static scan: an expression id is compared by its source text
 * (`htmlFor={scopeId}` ↔ `id={scopeId}`) across the whole file, so two
 * components in one file that reuse the same variable name can pair a label
 * with the other component's trigger. That never fails a named trigger, but
 * it can hide a missing name; give each label/trigger pair a distinct id
 * name (`useId()` per pair, as the settings dialogs do).
 */
function unnamedSelectTriggers(sourceText: string, fileName = "fixture.tsx"): string[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const labelTargets = new Set<string>();
  const triggers: Array<{ attributes: ts.JsxAttributes; node: ts.Node; inField: boolean }> = [];
  const visit = (node: ts.Node, inField: boolean) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    let childInField = inField;
    if (opening) {
      const tag = opening.tagName.getText();
      if (LABEL_TAGS.has(tag)) {
        const target = attributeValue(attribute(opening.attributes, "htmlFor"));
        if (target) labelTargets.add(target);
      }
      if (tag === "Field" && hasName(attribute(opening.attributes, "label"))) childInField = true;
      if (tag === "SelectTrigger") triggers.push({ attributes: opening.attributes, node: opening, inField });
    }
    ts.forEachChild(node, (child) => visit(child, childInField));
  };
  visit(source, false);
  return triggers
    .filter(({ attributes, inField }) => {
      if (inField) return false;
      if (attributes.properties.some((p) => ts.isJsxSpreadAttribute(p))) return false;
      if (hasName(attribute(attributes, "aria-label")) || hasName(attribute(attributes, "aria-labelledby"))) return false;
      const id = attributeValue(attribute(attributes, "id"));
      return !(id && labelTargets.has(id));
    })
    .map(({ node }) => `${fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
}

function scanSelectTriggers(): string[] {
  return appTsxFiles(SRC).flatMap((file) => unnamedSelectTriggers(readFileSync(file, "utf8"), relative(ROOT, file).split(sep).join("/")));
}

describe("accessible names", () => {
  const findings = scan();

  it("names every icon-only button with aria-label", () => {
    expect(findings.unnamedIconButtons.join("\n")).toBe("");
  });

  it("translates every title and aria-label", () => {
    expect(findings.literalLabels.join("\n")).toBe("");
  });

  it("names every Select trigger (combobox)", () => {
    expect(scanSelectTriggers().join("\n")).toBe("");
  });
});

describe("unnamedSelectTriggers (fixtures)", () => {
  const select = (trigger: string, around = (x: string) => x) => `
    const A = () => (
      <div>
        ${around(`<Select><${trigger}><SelectValue placeholder={t("x.placeholder")} /></SelectTrigger></Select>`)}
      </div>
    );`;
  const trigger = (attrs: string) => `SelectTrigger ${attrs}`;

  it.each([
    ["no name at all", select(trigger('className="w-32"'))],
    ["a placeholder only", select(trigger(""))],
    ["an id no label points at", select(trigger('id="range"'))],
    ["a label for another id", select(trigger('id="range"'), (x) => `<Label htmlFor="other">Range</Label>${x}`)],
    ["a label without htmlFor", select(trigger('className="mt-1"'), (x) => `<Label>Range</Label>${x}`)],
    ["an empty aria-label", select(trigger('aria-label=""'))],
    ["a Field without a label", select(trigger(""), (x) => `<Field help="h">${x}</Field>`)],
  ])("flags %s", (_name, source) => {
    expect(unnamedSelectTriggers(source)).toHaveLength(1);
  });

  it.each([
    ["aria-label", select(trigger('aria-label={t("board.tool")}'))],
    ["aria-labelledby", select(trigger('aria-labelledby="range-label"'))],
    ["a <Label htmlFor> string id", select(trigger('id="range"'), (x) => `<Label htmlFor="range">Range</Label>${x}`)],
    ["a <label htmlFor> expression id", select(trigger("id={selectId}"), (x) => `<label htmlFor={selectId}>Range</label>${x}`)],
    ["a label after the trigger", select(trigger('id="range"'), (x) => `${x}<Label htmlFor="range">Range</Label>`)],
    ["a surrounding Field with a label", select(trigger(""), (x) => `<Field label={t("x.range")}>${x}</Field>`)],
    ["spread props", select(trigger("{...triggerProps}"))],
  ])("accepts %s", (_name, source) => {
    expect(unnamedSelectTriggers(source)).toEqual([]);
  });
});
