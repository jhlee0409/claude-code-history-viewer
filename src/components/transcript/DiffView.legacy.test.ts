import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
const root = resolve(__dirname, "../../..");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [resolve(dir, e.name)] : []);
it("no legacy diff modules, imports or runtime dependency remain", () => {
  const legacy = /(?:EnhancedDiffViewer|AdvancedTextDiff|FilteredDiffLines|react-diff-viewer-continued)/;
  const imports = files(resolve(root, "src")).flatMap(file => [...readFileSync(file, "utf8").matchAll(/(?:from\s*|import\s*\(|vi\.mock\s*\()(["'])([^"']+)\1/g)].filter(m => legacy.test(m[2]!)).map(m => `${file}:${m[2]}`));
  expect(imports).toEqual([]);
  expect(Object.keys(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).dependencies)).not.toContain("react-diff-viewer-continued");
  expect(files(resolve(root, "src")).filter(f => /\/(?:EnhancedDiffViewer|AdvancedTextDiff|FilteredDiffLines)\.tsx$/.test(f))).toEqual([]);
});
it("all diff presentation code uses semantic colour tokens, never palette/hex", () => {
  const presentation = ["transcript/DiffView.tsx", "transcript/DiffViewComparison.tsx", "toolResultRenderer/StructuredPatchRenderer.tsx"];
  for (const file of presentation) {
    const source = readFileSync(resolve(root, "src/components", file), "utf8");
    expect(source).not.toMatch(/#[\da-f]{3,8}\b|(?:bg|text|border)-(?:white|black|(?:red|green|gray|slate|zinc)-\d+)/i);
    expect(source).not.toMatch(/<button\b/);
  }
});
