/**
 * Icon invariants (plan T5, decision D11).
 *
 * - lucide-react is pinned to one exact version, the one installed.
 * - Every icon imported from lucide-react uses its canonical name in that
 *   version: no deprecated alias (`AlertTriangle`, `Loader2`, `*Icon`, ...)
 *   and no name the package no longer ships (`GithubIcon`).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const LUCIDE_DIR = join(ROOT, "node_modules/lucide-react");

/** Type-only exports of lucide-react that are not icons. */
const LUCIDE_TYPES = new Set(["LucideIcon", "LucideProps", "IconNode"]);
/** Non-icon runtime exports the app may use. */
const LUCIDE_RUNTIME_HELPERS = new Set(["LucideProvider"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** Names exported by the installed lucide-react: canonical vs alias -> target. */
function lucideExports(): { canonical: Set<string>; aliases: Map<string, string> } {
  const dts = readFileSync(join(LUCIDE_DIR, "dist/lucide-react.d.ts"), "utf8");
  const match = /export \{ (AArrowDown[^}]*)\}/.exec(dts);
  if (!match?.[1]) throw new Error("could not find lucide-react's export list");
  const canonical = new Set<string>();
  const aliases = new Map<string, string>();
  for (const part of match[1].split(",")) {
    const [local, exported] = part.trim().split(/\s+as\s+/);
    if (!local) continue;
    if (!exported) canonical.add(local);
    else if (exported !== local) aliases.set(exported, local);
  }
  return { canonical, aliases };
}

interface LucideImport {
  file: string;
  /** The imported (not local) name. */
  name: string;
  typeOnly: boolean;
}

function lucideImports(sf: ts.SourceFile): LucideImport[] {
  const out: LucideImport[] = [];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith("lucide-react")) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) {
      out.push({ file: sf.fileName, name: "<non-named import>", typeOnly: false });
      continue;
    }
    for (const element of bindings.elements) {
      out.push({
        file: sf.fileName,
        name: (element.propertyName ?? element.name).text,
        typeOnly: Boolean(clause?.isTypeOnly || element.isTypeOnly),
      });
    }
  }
  return out;
}

const files = sourceFiles(SRC);
const parsed = files.map(parse);
const rel = (file: string) => relative(ROOT, file);

describe("icon invariants", () => {
  it("pins lucide-react to the exact installed version", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const installed = JSON.parse(readFileSync(join(LUCIDE_DIR, "package.json"), "utf8"));
    const spec: string = pkg.dependencies["lucide-react"];
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
    expect(spec).toBe(installed.version);
  });

  it("imports lucide icons only by their canonical names", () => {
    const { canonical, aliases } = lucideExports();
    const offenders: string[] = [];
    for (const sf of parsed) {
      for (const { file, name, typeOnly } of lucideImports(sf)) {
        if (LUCIDE_TYPES.has(name) || LUCIDE_RUNTIME_HELPERS.has(name)) continue;
        if (typeOnly) continue;
        if (canonical.has(name)) continue;
        const target = aliases.get(name);
        offenders.push(
          target
            ? `${rel(file)}: ${name} is a deprecated alias of ${target}`
            : `${rel(file)}: ${name} is not exported by lucide-react`
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
