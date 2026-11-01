import { strict as assert } from "node:assert";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import { JSDOM } from "jsdom";

// Run with Node 22: node scripts/export-parity.mjs /absolute/debug/binary
// No browser/network or real transcript is involved; both actual HTML exporters run.
const binary = path.resolve(process.argv[2] ?? "src-tauri/target/debug/claude-code-history-viewer");
const cases = JSON.parse(await readFile("src-tauri/tests/fixtures/export-parity.json", "utf8"));
const scratch = path.join(process.env.HOME, ".hermes/cache/scratch");
const dir = await mkdtemp(path.join(scratch, "ex1-parity-"));
const server = await createServer({
  configFile: false,
  resolve: { alias: { "@": path.resolve("src") } },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
  appType: "custom",
});
const normalize = (text) => {
  // JSON member order/indentation is not a visible fact. Keep all values and keys.
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  try { return JSON.stringify(canonical(JSON.parse(text))); }
  catch { return text.replace(/\s+/g, " ").trim(); }
};
try {
  const { exportToHtml } = await server.ssrLoadModule("/src/services/export/htmlExporter.ts");
  const raw = cases.map((row, i) => ({ type: "assistant", uuid: `case-${i}`, timestamp: "2026-01-01T00:00:00Z", message: { content: [row.block] } }));
  const input = path.join(dir, "parity.jsonl");
  const output = path.join(dir, "parity.html");
  await writeFile(input, raw.map(row => JSON.stringify(row)).join("\n"));
  const result = spawnSync(binary, ["--export", input, "--format", "html", "--output", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const rust = new JSDOM(await readFile(output, "utf8")).window.document;
  const ts = new JSDOM(exportToHtml(raw.map(row => ({ ...row, content: row.message.content })), "Parity")).window.document;
  const rustBlocks = [...rust.querySelectorAll(".content")];
  const tsBlocks = [...ts.querySelectorAll(".content")];
  assert.equal(rustBlocks.length, cases.length);
  assert.equal(tsBlocks.length, cases.length);
  for (const [i, row] of cases.entries()) {
    assert.equal(normalize(rustBlocks[i].textContent), normalize(tsBlocks[i].textContent), row.name);
    assert.equal(normalize(rustBlocks[i].textContent), normalize(row.text), row.name);
    assert.equal(rustBlocks[i].querySelector("script"), null);
    assert.equal(rustBlocks[i].textContent.includes("opaque-do-not-display"), false);
  }
  console.log(JSON.stringify({ cases: cases.length, equivalent: cases.length, crashes: 0, comparison: "per-message .content textContent; JSON canonicalized, otherwise whitespace collapsed" }));
} finally {
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
