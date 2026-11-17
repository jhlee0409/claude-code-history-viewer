// Intended visual changes: the `--expect-changed` list syntax and the PR-body
// line `ui-expected-changes: <id>, <prefix>*` (lib/expectedChanges.mjs), and
// the CLI the ui-harness job runs on $PR_BODY (expected-changes.mjs).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExpectedChangesError, expectedBy, expectedChangesFromBody, parseExpectedList, unmatchedPatterns } from "../lib/expectedChanges.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "expected-changes.mjs");

describe("expectedChangesFromBody (PR body)", () => {
  it("declares nothing for an empty or missing body", () => {
    expect(expectedChangesFromBody("")).toEqual([]);
    expect(expectedChangesFromBody(null)).toEqual([]);
    expect(expectedChangesFromBody(undefined)).toEqual([]);
  });

  it("declares nothing when no line starts with the key", () => {
    const body = "## What\n\nCopy changes only.\n\nSee ui-expected-changes: in the README.\n- ui-expected-changes: home--*";
    expect(expectedChangesFromBody(body)).toEqual([]);
  });

  it("reads a comma list of exact ids", () => {
    const body = "Intro\nui-expected-changes: home--390x844--dark, settings--390x844--dark,transcript-mixed-turn--390x844--dark\nOutro";
    expect(expectedChangesFromBody(body)).toEqual(["home--390x844--dark", "settings--390x844--dark", "transcript-mixed-turn--390x844--dark"]);
  });

  it("reads a CRLF body (GitHub's web editor) without keeping the \\r", () => {
    const body = "## UI\r\nui-expected-changes: home--390x844--dark, home--1440x900--dark\r\n\r\nMore text\r\n";
    expect(expectedChangesFromBody(body)).toEqual(["home--390x844--dark", "home--1440x900--dark"]);
  });

  it("keeps a trailing * as a prefix glob", () => {
    expect(expectedChangesFromBody("ui-expected-changes: home--*, transcript-mixed-turn--390x844--dark")).toEqual([
      "home--*",
      "transcript-mixed-turn--390x844--dark",
    ]);
  });

  it("merges several lines and drops repeats; indentation, key case and a trailing comma are fine", () => {
    const body = ["ui-expected-changes: home--*,", "text", "   UI-Expected-Changes:   settings--390x844--dark , home--*", "```", "ui-expected-changes: sidebar--390x844--dark", "```"].join("\n");
    expect(expectedChangesFromBody(body)).toEqual(["home--*", "settings--390x844--dark", "sidebar--390x844--dark"]);
  });

  it("treats a line with no ids as nothing declared", () => {
    expect(expectedChangesFromBody("ui-expected-changes:\nui-expected-changes:   ")).toEqual([]);
  });

  it("ignores lines inside HTML comments: reviewers cannot see them", () => {
    const body = "<!--\nui-expected-changes: home--*\n-->\nui-expected-changes: settings--390x844--dark\n<!-- unclosed\nui-expected-changes: sidebar--390x844--dark";
    expect(expectedChangesFromBody(body)).toEqual(["settings--390x844--dark"]);
  });

  it.each([
    ["space instead of a comma", "ui-expected-changes: home--390x844--dark settings--390x844--dark"],
    ["prose", "ui-expected-changes: see the screenshots"],
    ["a bare * (would accept every change)", "ui-expected-changes: *"],
    ["a * that is not trailing", "ui-expected-changes: home--*--dark"],
    ["upper case", "ui-expected-changes: Home--390x844--dark"],
    ["a file name", "ui-expected-changes: home--390x844--dark.png"],
    ["backticks", "ui-expected-changes: `home--390x844--dark`"],
    ["shell syntax", "ui-expected-changes: $(touch /tmp/pwned)"],
    ["a command separator", "ui-expected-changes: home--390x844--dark; rm -rf ~"],
  ])("rejects garbage: %s", (_label, body) => {
    expect(() => expectedChangesFromBody(`Intro\n${body}\n`)).toThrow(ExpectedChangesError);
  });

  it("names the offending entry", () => {
    expect(() => expectedChangesFromBody("ui-expected-changes: home--*, Settings--390x844--dark")).toThrow(/"Settings--390x844--dark"/);
  });
});

describe("parseExpectedList (--expect-changed)", () => {
  it("parses the same comma syntax", () => {
    expect(parseExpectedList("home--*,settings--390x844--dark, home--*")).toEqual(["home--*", "settings--390x844--dark"]);
  });

  it("rejects what the PR-body line rejects", () => {
    expect(() => parseExpectedList("home--390x844--dark settings--390x844--dark")).toThrow(ExpectedChangesError);
    expect(() => parseExpectedList("*")).toThrow(/bare \*/);
  });
});

describe("matching scenario ids", () => {
  const ids = ["home--1440x900--dark", "home--390x844--dark", "settings--390x844--dark"];

  it("an exact id matches only itself; a glob matches its prefix", () => {
    expect(expectedBy("home--390x844--dark", ["home--390x844--dark"])).toBe("home--390x844--dark");
    expect(expectedBy("home--1440x900--dark", ["home--390x844--dark"])).toBeNull();
    expect(expectedBy("home--1440x900--dark", ["settings--*", "home--*"])).toBe("home--*");
    expect(expectedBy("settings--390x844--dark", ["home--*"])).toBeNull();
  });

  it("unmatchedPatterns names the entries that match no scenario (typos)", () => {
    expect(unmatchedPatterns(["home--*", "settings--390x844--dark"], ids)).toEqual([]);
    expect(unmatchedPatterns(["home--390x844--drak", "home--*", "palette-*"], ids)).toEqual(["home--390x844--drak", "palette-*"]);
  });
});

describe("expected-changes.mjs (reads $PR_BODY in CI)", () => {
  const run = (body) => spawnSync(process.execPath, [CLI], { env: body === undefined ? {} : { PR_BODY: body }, encoding: "utf8" });

  it("prints the declared list, comma-joined", () => {
    const result = run("Intro\r\nui-expected-changes: home--*, settings--390x844--dark\r\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("home--*,settings--390x844--dark\n");
  });

  it("prints nothing when nothing is declared (or there is no PR body)", () => {
    for (const body of [undefined, "", "No declaration here."]) {
      const result = run(body);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    }
  });

  it("exits 2 with the reason on garbage, and prints nothing a step could pass on", () => {
    const result = run("ui-expected-changes: home--390x844--dark; rm -rf ~");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/ui-expected-changes/);
    expect(result.stderr).toMatch(/"home--390x844--dark; rm -rf ~"/);
  });
});

// The flag is checked right after the scenarios are selected - before any
// build or capture - so `--list` exercises it without a browser.
describe("run.mjs --expect-changed", () => {
  const REPO = path.resolve(HERE, "..", "..", "..");
  const RUN = path.join(REPO, "scripts", "ui-capture", "run.mjs");
  const CI_GATE = ["--scenarios", "scripts/ui-capture/ci-scenarios.mjs", "--base", "HEAD", "--gate", "unchanged"];
  const runCli = (args) => spawnSync(process.execPath, [RUN, ...args, "--list"], { cwd: REPO, encoding: "utf8" });

  it("accepts entries that cover selected scenarios", () => {
    const result = runCli([...CI_GATE, "--expect-changed", "home--*,settings--390x844--dark"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")).toContain("home--390x844--dark");
  });

  it("exits 2 on an entry that matches no selected scenario: a typo, or an id outside the CI subset", () => {
    for (const entry of ["home--390x844--drak", "transcript--1440x900--dark"]) {
      const result = runCli([...CI_GATE, "--expect-changed", `home--*,${entry}`]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(entry);
      expect(result.stdout).toBe("");
    }
  });

  it("exits 2 on garbage and on an empty list", () => {
    for (const list of ["home--390x844--dark settings--390x844--dark", "*", ""]) {
      expect(runCli([...CI_GATE, "--expect-changed", list]).status).toBe(2);
    }
  });

  it("exits 2 unless the gate is unchanged", () => {
    const changedGate = runCli(["--base", "HEAD", "--gate", "changed", "--expect-changed", "home--*"]);
    expect(changedGate.status).toBe(2);
    expect(changedGate.stderr).toMatch(/--gate unchanged/);
    expect(runCli(["--expect-changed", "home--*"]).status).toBe(2);
  });
});
