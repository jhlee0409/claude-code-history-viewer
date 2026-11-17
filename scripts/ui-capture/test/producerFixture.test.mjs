import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { generateFixture } from "../fixtures/generate.mjs";

it("keeps producer-context capture shapes synthetic and opt-in", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cchv-producer-fixture-"));
  const original = process.env.CCHV_CAPTURE_PRODUCER_CONTEXT;
  const records = (manifest, key) => {
    const named = manifest.namedSessions[key];
    const project = manifest.projects.find(p => p.name === named.project);
    const file = project.sessions.find(s => s.key === key).filePath;
    return fs.readFileSync(file, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  };
  try {
    delete process.env.CCHV_CAPTURE_PRODUCER_CONTEXT;
    const standard = generateFixture({ root });
    expect(records(standard, "patch-only").filter(r => r.payload.role === "user")).toHaveLength(1);
    expect(records(standard, "outcomes").some(r => String(r.message?.content).startsWith("<bash-input>"))).toBe(false);
    process.env.CCHV_CAPTURE_PRODUCER_CONTEXT = "1";
    const fixture = generateFixture({ root });
    expect(records(fixture, "patch-only").filter(r => r.payload.role === "user").slice(1).map(r => r.payload.content)).toEqual([
      [{ type: "input_text", text: '<codex_internal_context source="user_goal">Synthetic goal context</codex_internal_context>' }],
      [{ type: "input_text", text: "<recommended_plugins>Synthetic plugin context</recommended_plugins>" }],
      [{ type: "input_text", text: "<turn_aborted>Synthetic abort context</turn_aborted>" }],
      [{ type: "input_text", text: "<heartbeat>\n  <automation_id>synthetic</automation_id>\n  <current_time_iso>2026-09-23T00:00:00Z</current_time_iso>\n  <instructions>\nSynthetic client wake\n  </instructions>\n</heartbeat>" }],
    ]);
    const bash = records(fixture, "outcomes").filter(r => r.type === "user" && typeof r.message.content === "string").map(r => r.message.content);
    expect(bash.slice(1, 3)).toEqual(["<bash-input>printf synthetic</bash-input>", "<bash-stdout>synthetic</bash-stdout><bash-stderr></bash-stderr>"]);
  } finally {
    if (original === undefined) delete process.env.CCHV_CAPTURE_PRODUCER_CONTEXT;
    else process.env.CCHV_CAPTURE_PRODUCER_CONTEXT = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
