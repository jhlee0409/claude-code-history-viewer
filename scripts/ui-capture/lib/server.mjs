// WebUI server lifecycle for a capture run: free loopback port, sanitized
// environment pointing HOME at the fixture, readiness poll, log capture.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const HOST = "127.0.0.1";

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Environment for the server: nothing from the caller's shell except PATH
 * and TMPDIR. HOME is the fixture; CLAUDE_CONFIG_DIR / CODEX_HOME / XDG_* are
 * deliberately absent so no provider can reach the real user's data, and
 * GIT_CEILING_DIRECTORIES stops `git log` in a fixture project from walking
 * up into this repository.
 */
export function serverEnv({ home, fixtureRoot }) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TZ: "UTC",
    LANG: "en_US.UTF-8",
    GIT_CEILING_DIRECTORIES: fixtureRoot,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

export async function startServer({ binary, dist, home, fixtureRoot, logFile }) {
  const port = await freePort();
  const args = ["--serve", "--no-auth", "--host", HOST, "--port", String(port), "--dist", dist, "--no-watch"];
  const log = fs.createWriteStream(logFile);
  const child = spawn(binary, args, { env: serverEnv({ home, fixtureRoot }), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const origin = `http://${HOST}:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited during startup (${JSON.stringify(exited)}); see ${logFile}`);
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (Date.now() >= deadline) {
    child.kill("SIGKILL");
    throw new Error(`server did not answer on ${origin} within 30s; see ${logFile}`);
  }

  return {
    origin,
    port,
    args,
    async stop() {
      if (!exited) {
        const done = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        await done;
        clearTimeout(timer);
      }
      log.end();
    },
  };
}
