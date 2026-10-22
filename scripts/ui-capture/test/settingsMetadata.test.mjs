// Generated isolated HOME -> real server HTTP. No response mocks.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateFixture } from "../fixtures/generate.mjs";
import { startServer, freePort, serverEnv } from "../lib/server.mjs";
import { spawn, spawnSync } from "node:child_process";
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
function snapshot(dir) {
  const entries = [];
  const walk = (folder) => {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), stat = fs.lstatSync(file);
      entries.push([file, stat.mode, stat.size, stat.mtimeMs, stat.isFile() ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null]);
      if (stat.isDirectory()) walk(file);
    }
  };
  walk(dir);
  return entries;
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
    // The test process and spawned native server run on the same host. This
    // is platform proof, not frontend/browser platform inference.
    if (process.platform !== "darwin") {
      expect(body.managed).toBe(null);
      expect(body.metadata.scopes.managed).toEqual({ path: null, state: "unsupported", readOnly: true });
    }
  });
  it("distinguishes missing, empty, raw JSON and failed reads without modifying settings", async () => {
    const file = path.join(fixture.home, ".claude/settings.json");
    const held = `${file}.se0a-held`;
    fs.renameSync(file, held);
    try {
      for (const [label, data, state, content] of [
        ["missing", undefined, "missing", "{}"], ["empty-object", "{}", "present", "{}"],
        ["empty-file", "", "present", ""], ["numeric", "9007199254740993", "present", "9007199254740993"],
        ["null-json", "null", "present", "null"], ["malformed-json", "{invalid", "present", "{invalid"],
        ["invalid-utf8", Buffer.from([255]), "read_error", null],
      ]) {
        if (data !== undefined) fs.writeFileSync(file, data);
        const before = snapshot(fixture.home);
        const result = await call();
        expect(result.status).toBe(200);
        expect(result.body.user).toBe(content);
        expect(result.body.metadata.scopes.user).toEqual({ path: file, state, readOnly: false });
        expect(result.body.metadata.scopes.project).toEqual({ path: null, state: "no_project", readOnly: false });
        expect(result.body.metadata.scopes.local.state).toBe("no_project");
        expect(snapshot(fixture.home)).toEqual(before);
        if (data !== undefined) fs.renameSync(file, `${file}.se0a-${label}`);
      }
      fs.mkdirSync(file);
      expect((await call()).body.metadata.scopes.user.state).toBe("read_error");
      fs.renameSync(file, `${file}.se0a-directory`);
      if (process.platform !== "win32") {
        expect(spawnSync("mkfifo", [file]).status).toBe(0);
        const fifo = await call();
        expect(fifo.body.user).toBe(null);
        expect(fifo.body.metadata.scopes.user.state).toBe("read_error");
        fs.renameSync(file, `${file}.se0a-fifo`);
        fs.writeFileSync(file, "{}");
        fs.chmodSync(file, 0o000);
        try {
          expect((await call()).body.metadata.scopes.user.state).toBe("read_error");
        } finally { fs.chmodSync(file, 0o600); }
        fs.renameSync(file, `${file}.se0a-unreadable`);
        fs.symlinkSync(held, file);
        expect((await call()).body.metadata.scopes.user).toEqual({ path: file, state: "present", readOnly: false });
        fs.renameSync(file, `${file}.se0a-link`);
      }
    } finally { fs.renameSync(held, file); }
  });
  it("retains HTTP project traversal and unknown-project rejection without metadata leakage", async () => {
    for (const projectPath of ["relative/project", path.join(root, "unknown-project"), `${fixture.home}/../escape`]) {
      const result = await call({ projectPath });
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.body).not.toHaveProperty("metadata");
      expect(JSON.stringify(result.body)).not.toContain('"serverHome"');
    }
  });
  it("does not expose server home without the existing bearer authorization", async () => {
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    const token = "se0a-isolated-test-only";
    const log = fs.createWriteStream(path.join(root, "authenticated-server.log"));
    const child = spawn(binary, ["--serve", "--host", "127.0.0.1", "--port", String(port), "--dist", dist, "--token", token, "--no-watch"], { env: serverEnv({ home: fixture.home, fixtureRoot: root }), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log); child.stderr.pipe(log);
    let spawnError;
    child.on("error", (error) => { spawnError = error; });
    const request = (authenticated) => fetch(`${origin}/api/get_all_settings`, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: "{}" });
    try {
      let denied;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null) throw new Error(`auth server exited: ${child.exitCode}`);
        try { denied = await request(false); break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      }
      expect(denied?.status).toBe(401);
      const deniedText = await denied.text();
      expect(deniedText).not.toContain(fixture.home);
      expect(deniedText).not.toContain("serverHome");
      const allowed = await request(true);
      expect(allowed.status).toBe(200);
      expect((await allowed.json()).metadata.serverHome).toBe(fixture.home);
      observations.push({ auth: { denied: denied.status, allowed: allowed.status, deniedText } });
    } finally {
      const done = new Promise((resolve) => child.once("exit", resolve));
      if (child.exitCode === null && !spawnError) { child.kill("SIGTERM"); await done; }
      log.end();
    }
  });
});
