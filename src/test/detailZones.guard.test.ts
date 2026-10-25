/**
 * Every opened ToolRow detail renders through DetailZone (owner option B):
 * in `src/components/contentRenderer/unifiedCards/*.tsx`, each child of a
 * `<ToolRow>` element is a `<DetailZone>` — directly, behind `cond && …`,
 * in a ternary, in a fragment — or an element marked `data-detail-aside`
 * (navigation to other transcripts, which is neither input nor result).
 * Anything else — a bare `<ToolResultOutputs>`, `<OutputBlock>`, a
 * `{routed.body}` expression, a zone wrapped in a `<div>` — fails.
 *
 * The scan uses the TypeScript parser and follows import aliases
 * (`import { ToolRow as Row }`), proved both ways with in-memory fixtures.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const CARDS_DIR = join(ROOT, "src/components/contentRenderer/unifiedCards");

/** Local names bound to `name` by imports (and `name` itself). */
function localNames(source: ts.SourceFile, name: string): Set<string> {
  const names = new Set([name]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) if ((el.propertyName ?? el.name).text === name) names.add(el.name.text);
  }
  return names;
}

const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
const attributes = (node: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes);
const hasAside = (node: ts.JsxElement | ts.JsxSelfClosingElement) => attributes(node).properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "data-detail-aside");

const unwrap = (node: ts.Expression): ts.Expression => {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
  return n;
};

/** Problems with one ToolRow child (empty when it is a zone or an aside). */
function checkChild(node: ts.Node, zones: Set<string>, out: string[]): void {
  if (ts.isJsxText(node)) {
    if (node.getText().trim() !== "") out.push(`bare text "${node.getText().trim().slice(0, 40)}"`);
    return;
  }
  if (ts.isJsxExpression(node)) {
    if (node.expression) checkExpression(node.expression, zones, out);
    return;
  }
  if (ts.isJsxFragment(node)) {
    for (const child of node.children) checkChild(child, zones, out);
    return;
  }
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    if (zones.has(tagName(node)) || hasAside(node)) return;
    out.push(`<${tagName(node)}> outside a DetailZone`);
    return;
  }
  out.push(`unexpected child ${ts.SyntaxKind[node.kind]}`);
}

function checkExpression(expr: ts.Expression, zones: Set<string>, out: string[]): void {
  const e = unwrap(expr);
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    // `cond && <X/>`: only the rendered side matters; `a || <X/>` / `a ?? <X/>` render either side.
    if (e.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) checkExpression(e.left, zones, out);
    checkExpression(e.right, zones, out);
    return;
  }
  if (ts.isConditionalExpression(e)) {
    checkExpression(e.whenTrue, zones, out);
    checkExpression(e.whenFalse, zones, out);
    return;
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(e) && e.text === "undefined")) return;
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) {
    checkChild(e, zones, out);
    return;
  }
  out.push(`expression {${e.getText().slice(0, 50)}} outside a DetailZone`);
}

/** Every ToolRow child in `text` that is not a DetailZone or an aside. */
function bareDetailChildren(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rows = localNames(source, "ToolRow");
  const zones = localNames(source, "DetailZone");
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && rows.has(node.openingElement.tagName.getText())) {
      for (const child of node.children) checkChild(child, zones, out);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const card = (body: string, imports = 'import { ToolRow } from "../../transcript/ToolRow";\nimport { DetailZone } from "../../transcript/DetailZone";') =>
  `${imports}\nexport function Card({ x, items, routed }: any) { return (${body}); }`;

describe("guard fixtures", () => {
  it.each([
    ["a bare result well", "<ToolRow><ToolResultOutputs results={[]} /></ToolRow>"],
    ["a bare well behind &&", "<ToolRow>{x && <OutputBlock text='a' />}</ToolRow>"],
    ["a zone wrapped in a div", "<ToolRow><div><DetailZone kind='input'>a</DetailZone></div></ToolRow>"],
    ["a routed body expression", "<ToolRow>{routed.body}</ToolRow>"],
    ["a bare prose block in a fragment", "<ToolRow><><ProseBlock text='a' /></></ToolRow>"],
    ["a ternary with one bare branch", "<ToolRow>{x ? <DetailZone kind='result'>a</DetailZone> : <OutputBlock text='a' />}</ToolRow>"],
    ["a mapped list of wells", "<ToolRow>{items.map((i: string) => <OutputBlock key={i} text={i} />)}</ToolRow>"],
    ["bare text", "<ToolRow>loose words</ToolRow>"],
    ["a || fallback well", "<ToolRow>{routed.body || <DetailZone kind='input'>a</DetailZone>}</ToolRow>"],
  ])("%s fails", (_label, body) => {
    expect(bareDetailChildren("Bad.tsx", card(body)).length).toBeGreaterThan(0);
  });

  it("an aliased ToolRow is still scanned", () => {
    const imports = 'import { ToolRow as Row } from "../../transcript/ToolRow";';
    expect(bareDetailChildren("Alias.tsx", card("<Row><OutputBlock text='a' /></Row>", imports)).length).toBeGreaterThan(0);
  });

  it.each([
    ["zones directly, behind &&, in a ternary", "<ToolRow><DetailZone kind='input'>a</DetailZone>{x && <DetailZone kind='result'>b</DetailZone>}{x ? <DetailZone kind='result'>c</DetailZone> : null}</ToolRow>"],
    ["an aside and a comment", "<ToolRow>{/* note */}<DetailZone kind='result'>a</DetailZone><button data-detail-aside=''>View</button></ToolRow>"],
    ["zones in a fragment", "<ToolRow><><DetailZone kind='input'>a</DetailZone><DetailZone kind='result'>b</DetailZone></></ToolRow>"],
    ["a row without children", "<ToolRow verb='x' />"],
    ["a parenthesised zone", "<ToolRow>{x && (<DetailZone kind='input'>a</DetailZone>)}</ToolRow>"],
  ])("%s passes", (_label, body) => {
    expect(bareDetailChildren("Good.tsx", card(body))).toEqual([]);
  });

  it("an aliased DetailZone counts as a zone", () => {
    const imports = 'import { ToolRow } from "../../transcript/ToolRow";\nimport { DetailZone as Zone } from "../../transcript/DetailZone";';
    expect(bareDetailChildren("Alias.tsx", card("<ToolRow><Zone kind='input'>a</Zone></ToolRow>", imports))).toEqual([]);
  });
});

describe("unifiedCards: every ToolRow detail renders through DetailZone", () => {
  const files = readdirSync(CARDS_DIR).filter((f) => f.endsWith(".tsx"));
  it("scans the cards", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });
  it.each(files)("%s: no bare blocks in a ToolRow detail", (file) => {
    const text = readFileSync(join(CARDS_DIR, file), "utf8").replace(/\r\n/g, "\n");
    expect(bareDetailChildren(file, text)).toEqual([]);
  });
});
