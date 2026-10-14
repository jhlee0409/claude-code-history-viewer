import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `prose-*` modifier classes (prose-sm, dark:prose-invert, prose-a:text-info, ...)
 * only generate CSS when @tailwindcss/typography is loaded through an
 * `@plugin` directive. Without it they are silent no-ops, and the bare `prose`
 * class is styled by hand-written rules in src/index.css and src/App.css.
 *
 * Invariant: if no stylesheet under src/ loads the plugin, no source file uses
 * plugin-only classes and package.json does not depend on the plugin.
 * Loading the plugin later switches this check off on its own.
 */

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const PLUGIN = "@tailwindcss/typography";
const PLUGIN_DIRECTIVE = /@plugin\s+["']@tailwindcss\/typography["']/;

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

/** Text of every string / template literal in a TS(X) source, comments excluded. */
function literalTexts(source: string, fileName = "fixture.tsx"): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return texts;
}

/** Plugin-only class tokens in a source: `prose-*` utilities or variants, incl. `prose-${...}`. */
function findPluginOnlyProseClasses(source: string, fileName?: string): string[] {
  return literalTexts(source, fileName).flatMap((text) =>
    text.split(/\s+/).filter((token) =>
      // Either the utility (`prose-sm`, `dark:prose-invert`) or a variant (`prose-a:text-info`).
      token.split(":").some((segment) => segment.startsWith("prose-")),
    ),
  );
}

describe("findPluginOnlyProseClasses", () => {
  it.each([
    ['const a = "prose prose-sm max-w-none";', ["prose-sm"]],
    ['const a = "dark:prose-invert";', ["dark:prose-invert"]],
    ['const a = "prose-a:text-info prose-code:bg-muted";', ["prose-a:text-info", "prose-code:bg-muted"]],
    ["const a = `prose-${size}`;", ["prose-"]],
    ['<div className="prose prose-gray" />', ["prose-gray"]],
  ])("flags %s", (source, expected) => {
    expect(findPluginOnlyProseClasses(source)).toEqual(expected);
  });

  it.each([
    'const a = "prose max-w-none";',
    'const a = "not-prose";',
    "// surrounding prose.\nconst a = 1;",
    "// prose-like text\nconst a = 1;",
    "/* prose-sm in a block comment */ const a = 1;",
    "const re = /prose-x/;",
  ])("ignores %s", (source) => {
    expect(findPluginOnlyProseClasses(source)).toEqual([]);
  });
});

describe("typography plugin invariant", () => {
  const stylesheets = walk(SRC, (p) => p.endsWith(".css"));
  const pluginLoaded = stylesheets.some((p) => PLUGIN_DIRECTIVE.test(readFileSync(p, "utf8")));

  it("discovers the app stylesheets", () => {
    const names = stylesheets.map((p) => relative(ROOT, p));
    expect(names).toContain("src/index.css");
  });

  it.skipIf(pluginLoaded)("package.json does not depend on the unloaded plugin", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps)).not.toContain(PLUGIN);
  });

  it.skipIf(pluginLoaded)("no source uses plugin-only prose-* classes", () => {
    const sources = walk(SRC, (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith(".d.ts"));
    const violations = sources.flatMap((path) =>
      findPluginOnlyProseClasses(readFileSync(path, "utf8"), path).map(
        (token) => `${relative(ROOT, path)}: ${token}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
