// Inner-UI fixture cases (plan I0). The generator must stay byte-identical
// for the original catalog (the inner cases use their own PRNG streams) and
// each named case must have the exact shape the plan asks for.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixture, snapshotTree } from "../fixtures/generate.mjs";
import { E15_RESULT, INNER_CASES } from "../fixtures/inner.mjs";

let scratch;
let withInner;
let withoutInnerFiles;
const readJsonl = (file) => fs.readFileSync(file, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cchv-inner-fixture-"));
  // Same root both times (paths are part of the data), the catalog alone first.
  const root = path.join(scratch, "fixture");
  generateFixture({ root, inner: false });
  withoutInnerFiles = snapshotTree(root).files;
  withInner = { root, manifest: generateFixture({ root }) };
}, 120_000);

afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

const sessionFile = (key) => {
  const named = withInner.manifest.namedSessions[key];
  const project = withInner.manifest.projects.find((p) => p.name === named.project);
  return project.sessions.find((s) => s.key === key).filePath;
};
const toolResults = (records) =>
  records.flatMap((r) => (r.type === "user" && Array.isArray(r.message.content) ? r.message.content.filter((c) => c.type === "tool_result").map((c) => ({ item: c, record: r })) : []));

describe("inner fixture", () => {
  it("leaves every catalog file byte-identical (own PRNG streams) and discovers OpenCode", () => {
    const a = withoutInnerFiles;
    const b = snapshotTree(withInner.root).files;
    const changed = Object.keys(a).filter((file) => a[file] !== b[file]);
    expect(changed).toEqual([]);
    const meta = JSON.parse(fs.readFileSync(path.join(withInner.manifest.home, ".claude-history-viewer", "user-data.json"), "utf8"));
    expect(meta.settings.discoveredProviderIds).toEqual(["claude", "codex", "opencode"]);
    const added = Object.keys(b).filter((file) => !(file in a));
    expect(added.length).toBeGreaterThan(20);
  });

  it("names every case in the manifest", () => {
    expect(Object.keys(withInner.manifest.namedSessions).sort()).toEqual(Object.keys(INNER_CASES).sort());
  });

  it("E15: stdout empty, fatal stderr, interrupted false - no exit code, no is_error", () => {
    const [result] = toolResults(readJsonl(sessionFile("unknown-outcome")));
    expect(result.record.toolUseResult).toEqual(E15_RESULT);
    expect("is_error" in result.item).toBe(false);
  });

  it("outcomes: explicit exit 1, warning + exit 0, error_code, conflict, interrupted, no result, orphan", () => {
    const records = readJsonl(sessionFile("outcomes"));
    const results = toolResults(records);
    const byExit = Object.fromEntries(results.filter((r) => r.record.toolUseResult?.exitCode !== undefined).map((r) => [r.record.toolUseResult.exitCode, r]));
    expect(byExit[1].item.is_error).toBe(true);
    expect(byExit[0].record.toolUseResult.stderr).toMatch(/^warning:/);
    expect(byExit[2].item.is_error).toBe(false); // conflict: is_error false + exit 2
    expect(byExit[130].record.toolUseResult.interrupted).toBe(true);
    expect(results.some((r) => r.record.toolUseResult?.error_code === "url_not_accessible")).toBe(true);
    const calls = records.flatMap((r) => (r.type === "assistant" ? r.message.content.filter((c) => c.type === "tool_use").map((c) => c.id) : []));
    const answered = new Set(results.map((r) => r.item.tool_use_id));
    expect(calls.filter((id) => !answered.has(id))).toHaveLength(1); // a call without a result
    expect([...answered].filter((id) => !calls.includes(id))).toHaveLength(1); // an orphan result
  });

  it("mixed turn: Read·Grep run of four, an Edit with a diff, then a failing test run", () => {
    const records = readJsonl(sessionFile("mixed-turn"));
    const names = records.flatMap((r) => (r.type === "assistant" ? r.message.content.filter((c) => c.type === "tool_use").map((c) => c.name) : []));
    expect(names).toEqual(["Read", "Read", "Grep", "Read", "Edit", "Bash"]);
    const bash = toolResults(records).at(-1);
    expect(bash.record.toolUseResult.exitCode).toBe(1);
    const reads = names.filter((n) => n === "Read").length;
    expect(reads).toBe(3);
  });

  it("blocks: thinking, web search results, citations, image, document and an unknown block", () => {
    const types = readJsonl(sessionFile("blocks")).flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content.map((c) => c.type) : []));
    for (const type of ["thinking", "server_tool_use", "web_search_tool_result", "image", "document", "fixture_unknown_block"]) expect(types).toContain(type);
    const cited = readJsonl(sessionFile("blocks")).flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : [])).find((c) => c.citations);
    expect(cited.citations).toHaveLength(1);
  });

  it("scale: a 10,000-message session and one turn of 2,000 blocks", () => {
    expect(withInner.manifest.namedSessions["ten-thousand"].messageCount).toBe(10_000);
    const giant = readJsonl(sessionFile("giant-turn"));
    const promptIndex = giant.findIndex((r) => r.type === "user" && typeof r.message.content === "string");
    const blocks = giant.slice(promptIndex + 1, -1).flatMap((r) => r.message.content);
    expect(blocks).toHaveLength(2000);
  });

  it("usage: two models and two tiers in one session", () => {
    const assistants = readJsonl(sessionFile("usage-mix")).filter((r) => r.type === "assistant");
    expect(new Set(assistants.map((r) => r.message.model)).size).toBe(2);
    expect(new Set(assistants.map((r) => r.message.usage.service_tier)).size).toBe(2);
  });

  it("Codex: apply_patch only, one patch touching three files", () => {
    const project = withInner.manifest.projects.find((p) => p.name === "prism-gateway");
    const lines = readJsonl(project.sessions[0].filePath);
    const calls = lines.filter((l) => l.payload.type === "custom_tool_call" || l.payload.type === "function_call");
    expect(calls.every((l) => l.payload.name === "apply_patch")).toBe(true);
    expect(calls.some((l) => (l.payload.input.match(/^\*\*\* (Update|Add) File:/gm) ?? []).length === 3)).toBe(true);
  });

  it("OpenCode: newString fragment, multiedit input, empty write, source cost", () => {
    const storage = path.join(withInner.manifest.home, ".local", "share", "opencode", "storage");
    const parts = fs
      .readdirSync(path.join(storage, "part"), { recursive: true })
      .filter((f) => String(f).endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(storage, "part", String(f)), "utf8")));
    const tools = parts.filter((p) => p.type === "tool");
    expect(tools.some((p) => p.tool === "edit" && typeof p.state.input.newString === "string")).toBe(true);
    expect(tools.some((p) => p.tool === "multiedit" && Array.isArray(p.state.input.edits))).toBe(true);
    expect(tools.find((p) => p.tool === "write").state.input.content).toBe("");
    const messages = fs
      .readdirSync(path.join(storage, "message"), { recursive: true })
      .filter((f) => String(f).endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(storage, "message", String(f)), "utf8")));
    expect(messages.filter((m) => m.role === "assistant").every((m) => typeof m.cost === "number")).toBe(true);
  });
});
