// The automatic PR capture gate runs a fixed, exact-id subset of the matrix
// (second review N1): one named list in ci-scenarios.mjs, selected by exact
// id (not --only's substring match), the full matrix still the default.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { splitByActivation } from "../lib/activation.mjs";
import { selectScenarios } from "../lib/selection.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { CI_SCENARIO_IDS, SELECTED_IDS } from "../ci-scenarios.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const RUN = path.join(REPO, "scripts", "ui-capture", "run.mjs");
const CI_MODULE = "scripts/ui-capture/ci-scenarios.mjs";

// The review's table (scratch/i0/review-2.md, "Exact representative CI selection").
const REVIEW_TABLE = [
  ["1440x900", "dark", ["home", "transcript-mixed-turn", "x-transcript-edit-expanded", "transcript-failure", "transcript-unknown-outcome", "transcript-cjk", "analytics", "recent-edits", "board", "global-stats", "archive", "settings", "settings-dirty", "archive-error", "empty", "loading", "error", "palette-all-groups"]],
  ["1440x900", "light", ["transcript-mixed-turn", "x-transcript-edit-expanded", "analytics", "recent-edits", "settings", "gear"]],
  ["390x844", "dark", ["home", "sidebar", "transcript-mixed-turn", "x-transcript-edit-expanded", "recent-edits", "settings"]],
  ["1180x760", "dark", ["transcript-mixed-turn", "analytics"]],
];
const EXPECTED = REVIEW_TABLE.flatMap(([vp, theme, screens]) => screens.map((s) => `${s}--${vp}--${theme}`));

const activeScenarios = () => splitByActivation(expandScenarios()).active;
const listIds = (args) =>
  execFileSync(process.execPath, [RUN, ...args, "--list"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

describe("CI scenario subset (ci-scenarios.mjs)", () => {
  it("is exactly the review's 32 ids, no duplicates", () => {
    expect(CI_SCENARIO_IDS).toHaveLength(32);
    expect(new Set(CI_SCENARIO_IDS).size).toBe(32);
    expect([...CI_SCENARIO_IDS].sort()).toEqual([...EXPECTED].sort());
    expect(SELECTED_IDS).toBe(CI_SCENARIO_IDS);
  });

  it("names only active scenarios of the matrix", () => {
    const active = new Set(activeScenarios().map((s) => s.id));
    const missing = CI_SCENARIO_IDS.filter((id) => !active.has(id));
    expect(missing).toEqual([]);
  });
});

describe("selectScenarios (exact ids)", () => {
  it("selects by exact id, in matrix order - not --only's substring match", () => {
    const all = activeScenarios();
    expect(all.some((s) => s.id === "global-stats-after-analytics--1440x900--dark")).toBe(true);
    const ids = ["analytics--1440x900--dark", "home--1440x900--dark"];
    const picked = selectScenarios(all, ids).map((s) => s.id);
    expect(picked).toEqual(all.map((s) => s.id).filter((id) => ids.includes(id)));
    expect(picked).toHaveLength(2);
    expect(picked).not.toContain("global-stats-after-analytics--1440x900--dark");
  });

  it("refuses an unknown or duplicated id", () => {
    const all = activeScenarios();
    expect(() => selectScenarios(all, ["home--1440x900--dark", "nope--1440x900--dark"])).toThrow(/nope--1440x900--dark/);
    expect(() => selectScenarios(all, ["home--1440x900--dark", "home--1440x900--dark"])).toThrow(/duplicate.*home--1440x900--dark/);
  });

  it("refuses a later-active (not yet runnable) id", () => {
    expect(() => selectScenarios(activeScenarios(), ["analytics-activity--1440x900--dark"])).toThrow(/analytics-activity--1440x900--dark/);
  });
});

describe("run.mjs --list", () => {
  it("--scenarios ci-scenarios.mjs selects the 32 ids", () => {
    expect(listIds(["--scenarios", CI_MODULE]).sort()).toEqual([...EXPECTED].sort());
  });

  it("the default module still selects the full active matrix", () => {
    expect(listIds([])).toEqual(activeScenarios().map((s) => s.id));
  });
});

describe("frontend-tests.yml ui-harness", () => {
  const workflow = fs.readFileSync(path.join(REPO, ".github", "workflows", "frontend-tests.yml"), "utf8");

  it("gates PRs on the CI subset and keeps the full matrix behind workflow_dispatch", () => {
    expect(workflow).toContain(`--scenarios ${CI_MODULE}`);
    expect(workflow).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*full_matrix:/);
    expect(workflow).toMatch(/inputs\.full_matrix/);
  });
});
