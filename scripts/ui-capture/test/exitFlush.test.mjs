// run.mjs --list printed a truncated matrix on CI (202 of 259 ids): on Linux a
// child's stdout is a socket, ~200 small writes fill its send buffer, the rest
// are queued in the process, and process.exit() dropped them. The harness CLIs
// must exit only after stdout/stderr have flushed.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitByActivation } from "../lib/activation.mjs";
import { expandScenarios } from "../scenarios.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const RUN = path.join(REPO, "scripts", "ui-capture", "run.mjs");
const SLOW_STDOUT = path.join(HERE, "support", "slow-stdout.mjs");

const runSlow = (args) =>
  execFileSync(process.execPath, ["--import", SLOW_STDOUT, RUN, ...args], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("run.mjs exits after its output is flushed", () => {
  it("--list prints every active id even when stdout flushes late", () => {
    const ids = runSlow(["--list"]).split("\n").filter(Boolean);
    expect(ids).toEqual(splitByActivation(expandScenarios()).active.map((s) => s.id));
  });

  it("a usage error still reaches stderr (exit 2) when stderr flushes late", () => {
    let caught;
    try {
      runSlow(["--only", "no-such-scenario-xyz", "--list"]);
    } catch (error) {
      caught = error;
    }
    expect(caught?.status).toBe(2);
    expect(String(caught?.stderr)).toMatch(/no-such-scenario-xyz/);
  });
});
