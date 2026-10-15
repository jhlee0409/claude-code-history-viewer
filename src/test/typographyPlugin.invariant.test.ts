import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import postcss from "postcss";
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

/** Whether a stylesheet loads the plugin through a real `@plugin` at-rule (not comments or strings). */
function loadsTypographyPlugin(css: string): boolean {
  let loaded = false;
  postcss.parse(css).walkAtRules("plugin", (rule) => {
    if (rule.params.trim().replace(/^["']|["']$/g, "") === PLUGIN) loaded = true;
  });
  return loaded;
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

/** Text of every string / template literal in a TS(X) source, comments excluded. */
function literalTexts(source: string, fileName = "fixture.tsx"): string[] {
  // .ts must parse as TS: generic arrows and `<T>x` casts are invalid TSX and would hide literals.
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
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
    // Split on whitespace and HTML attribute punctuation so `class="prose-sm"` yields `prose-sm`.
    text.split(/[\s"'`=<>]+/).filter((token) =>
      // Either the utility (`prose-sm`, `dark:prose-invert`) or a variant (`prose-a:text-info`),
      // with an optional important modifier (`!prose-sm`, `prose-sm!`).
      token.split(":").some((segment) => segment.replace(/^!/, "").startsWith("prose-")),
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
    // Important modifier, leading (v3/v4) or trailing (v4).
    ['const a = "!prose-sm";', ["!prose-sm"]],
    ['const a = "hover:!prose-sm";', ["hover:!prose-sm"]],
    ['const a = "prose-sm!";', ["prose-sm!"]],
    ["const a = `!prose-${size}`;", ["!prose-"]],
    // Class attributes inside HTML strings (ansiToHtml, export templates).
    ['const html = `<div class="prose-sm">text</div>`;', ["prose-sm"]],
    ["const html = '<span class=\"prose-sm text-info\">x</span>';", ["prose-sm"]],
  ])("flags %s", (source, expected) => {
    expect(findPluginOnlyProseClasses(source)).toEqual(expected);
  });

  // Generic arrows and angle-bracket casts are valid .ts but not valid .tsx.
  it.each([
    'const identity = <T>(x: T): T => x; const cls = "prose-sm";',
    'const x = <string>"value"; const cls = "prose-sm";',
  ])("flags %s in a .ts file", (source) => {
    expect(findPluginOnlyProseClasses(source, "fixture.ts")).toEqual(["prose-sm"]);
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

describe("loadsTypographyPlugin", () => {
  it.each([
    ['@import "tailwindcss";\n@plugin "@tailwindcss/typography";', true],
    ["@plugin '@tailwindcss/typography';", true],
    ['@import "tailwindcss";', false],
    ['/* @plugin "@tailwindcss/typography"; */', false],
    ['/*\n  @plugin "@tailwindcss/typography";\n*/\n@import "tailwindcss";', false],
    ["a::before { content: '@plugin \"@tailwindcss/typography\"'; }", false],
    ['@plugin "@tailwindcss/forms";', false],
  ])("%s -> %s", (css, expected) => {
    expect(loadsTypographyPlugin(css)).toBe(expected);
  });
});

describe("typography plugin invariant", () => {
  const stylesheets = walk(SRC, (p) => p.endsWith(".css"));
  const pluginLoaded = stylesheets.some((p) => loadsTypographyPlugin(readFileSync(p, "utf8")));

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
