// Generated isolated HOME -> real server HTTP. No response mocks.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixture } from "../fixtures/generate.mjs";
import { startServer } from "../lib/server.mjs";
const binary = process.env.SETTINGS_TEST_BIN ?? path.resolve(".ui-capture/build/cchv-server");
const dist = process.env.SETTINGS_TEST_DIST ?? path.resolve(".ui-capture/build/dist");
const enabled = fs.existsSync(binary) && fs.existsSync(path.join(dist, "index.html"));
if (!enabled && process.env.CI_REQUIRE_BROWSER === "1") throw new Error("Settings contract requires the built server and dist");
const root = path.resolve("scratch/se0a/http-fixture");
const observations = [];
let fixture, server;
beforeAll(async () => {
  if (!enabled) return;
  fixture = generateFixture({ root });
  server = await startServer({ binary, dist, home: fixture.home, fixtureRoot: root, logFile: path.join(root, "server.log") });
});
afterAll(async () => {
  await server?.stop();
  if (enabled && process.env.SETTINGS_TEST_REPORT) fs.writeFileSync(process.env.SETTINGS_TEST_REPORT, JSON.stringify({ binary, sha256: createHash("sha256").update(fs.readFileSync(binary)).digest("hex"), observations }, null, 2));
});
async function call(args = {}) {
  const response = await fetch(`${server.origin}/api/get_all_settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  const body = await response.json();
  observations.push({ args, status: response.status, body });
  return { status: response.status, body };
}
describe.skipIf(!enabled)("authoritative settings metadata over real HTTP", () => {
  it("returns backend home and exact selected-project resolver paths", async () => {
    const project = fixture.projects.find((p) => p.provider === "claude");
    const { status, body } = await call({ projectPath: project.cwd });
    expect(status).toBe(200);
    expect(body.metadata?.serverHome).toBe(fixture.home);
    expect(body.metadata.scopes.user.path).toBe(path.join(fixture.home, ".claude/settings.json"));
    expect(body.metadata.scopes.project.path).toBe(path.join(fs.realpathSync(project.cwd), ".claude/settings.json"));
    expect(body.metadata.scopes.local.path).toBe(path.join(fs.realpathSync(project.cwd), ".claude/settings.local.json"));
    expect(body.metadata.scopes.managed.readOnly).toBe(true);
  });
});
