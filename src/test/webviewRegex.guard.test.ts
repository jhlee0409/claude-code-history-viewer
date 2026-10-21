/**
 * App code parses in the oldest WebView the app supports.
 *
 * The minimum is macOS 10.13 (`minimumSystemVersion` in tauri.conf.json), and
 * WKWebView before Safari 16.4 cannot parse a regex lookbehind (`(?<=…)`,
 * `(?<!…)`): a module holding one throws a SyntaxError when it loads, which
 * stops every screen that imports it. A capture group does the same job.
 * Tests run in Node and may use lookbehinds.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

const isTest = (path: string) =>
  /\.test\.tsx?$/.test(path) || path.includes(`${sep}__tests__${sep}`) || path.includes(`${sep}test${sep}`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const LOOKBEHIND = /\(\?<[=!]/;

/** `line: pattern` for every regex literal or `RegExp("…")` pattern with a lookbehind. */
function lookbehinds(code: string, fileName = "probe.tsx"): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, pattern: string) => {
    if (!LOOKBEHIND.test(pattern)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${line + 1}: ${pattern}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isRegularExpressionLiteral(node)) report(node, node.text);
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp"
    ) {
      const [pattern] = node.arguments ?? [];
      if (pattern && (ts.isStringLiteral(pattern) || ts.isNoSubstitutionTemplateLiteral(pattern))) {
        report(pattern, pattern.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("regex lookbehind: the oldest supported WebView cannot parse it", () => {
  it("finds a lookbehind in a literal and in a RegExp pattern", () => {
    expect(lookbehinds("const a = /(?<=\\d)x$/u;")).toEqual(["1: /(?<=\\d)x$/u"]);
    expect(lookbehinds("const a = /(?<![\\w$])t/;")).toEqual(["1: /(?<![\\w$])t/"]);
    expect(lookbehinds('const a = new RegExp("(?<=a)b");')).toEqual(["1: (?<=a)b"]);
    expect(lookbehinds("const a = RegExp(`(?<!a)b`, 'g');")).toEqual(["1: (?<!a)b"]);
  });

  it("leaves named groups, lookaheads and text alone", () => {
    expect(lookbehinds("const a = /(?<year>\\d{4})-(?=\\d)/;")).toEqual([]);
    expect(lookbehinds('const s = "(?<=a)"; // (?<!b)')).toEqual([]);
  });

  it("app code (not tests) has none", () => {
    const found = sourceFiles(SRC)
      .filter((file) => !isTest(file))
      .flatMap((file) =>
        lookbehinds(readFileSync(file, "utf8"), file).map(
          (hit) => `${relative(ROOT, file).split(sep).join("/")}:${hit}`,
        ),
      );
    expect(found).toEqual([]);
  });
});
