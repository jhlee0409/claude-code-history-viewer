// Fault injection for the run's server/browser ownership: a real server
// process is started, then a later step fails; the process must be gone.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withServerAndBrowser } from "../lib/lifecycle.mjs";
import { startServer } from "../lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let root;

/** Executable wrapper so startServer can spawn the fake like the real binary. */
function fakeBinary(extraArgs = "") {
  const file = path.join(root, "fake-server");
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, "fake-server.mjs")}" "$@" ${extraArgs}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

const start = (binary) => () =>
  startServer({ binary, dist: root, home: root, fixtureRoot: root, logFile: path.join(root, "server.log") });

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-lifecycle-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("withServerAndBrowser", () => {
  it("stops a running server when the browser launch fails", async () => {
    let server;
    const launchError = new Error("injected: webkit.launch failed");
    await expect(
      withServerAndBrowser(
        {
          startServer: async () => {
            server = await start(fakeBinary())();
            return server;
          },
          launchBrowser: async () => {
            expect(isAlive(server.pid)).toBe(true); // the fault hits a live server
            throw launchError;
          },
        },
        async () => {
          throw new Error("unreachable");
        },
      ),
    ).rejects.toBe(launchError);
    expect(isAlive(server.pid)).toBe(false);
  });

  it("closes the browser and stops the server when the run body fails", async () => {
    let server;
    let closed = false;
    const bodyError = new Error("injected: capture failed");
    await expect(
      withServerAndBrowser(
        {
          startServer: async () => {
            server = await start(fakeBinary())();
            return server;
          },
          launchBrowser: async () => ({
            close: async () => {
              closed = true;
              throw new Error("close failure must not mask the original error");
            },
          }),
        },
        async () => {
          throw bodyError;
        },
      ),
    ).rejects.toBe(bodyError);
    expect(closed).toBe(true);
    expect(isAlive(server.pid)).toBe(false);
  });

  it("does not launch a browser when the server fails to start", async () => {
    let launched = false;
    await expect(
      withServerAndBrowser(
        {
          startServer: start(fakeBinary("--exit-on-start")),
          launchBrowser: async () => {
            launched = true;
          },
        },
        async () => {},
      ),
    ).rejects.toThrow(/server exited during startup/);
    expect(launched).toBe(false);
  });

  it("reports a missing server binary as a startup failure", async () => {
    await expect(start(path.join(root, "does-not-exist"))()).rejects.toThrow(/server exited during startup/);
  });

  it("returns the body result after a clean teardown", async () => {
    let server;
    const value = await withServerAndBrowser(
      {
        startServer: async () => {
          server = await start(fakeBinary())();
          return server;
        },
        launchBrowser: async () => ({ close: async () => {} }),
      },
      async ({ server: s }) => s.origin,
    );
    expect(value).toBe(server.origin);
    expect(isAlive(server.pid)).toBe(false);
  });
});
