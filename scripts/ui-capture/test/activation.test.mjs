// Later-active scenarios (plan I0 (b), RR C7): declared with their owner
// task and old counterpart, never run, never silently dropped.

import { describe, expect, it } from "vitest";
import { splitByActivation } from "../lib/activation.mjs";
import { LATER_SCREENS, expandScenarios } from "../scenarios.mjs";

const PLAN_TASKS = new Set(["AN1", "AN2", "EV2", "EV3b", "SX1", "SE1", "AR1"]);

describe("later-active scenarios", () => {
  it("are split out of the run with their owner and 'before'", () => {
    const { active, inactive } = splitByActivation(expandScenarios());
    expect(active.some((s) => s.screen.activatesWith)).toBe(false);
    expect(inactive.length).toBe(LATER_SCREENS.length + 1); // + session-detail-sheet at 390
    expect(inactive.find((s) => s.id === "analytics-activity--1440x900--dark")).toEqual({
      id: "analytics-activity--1440x900--dark",
      activatesWith: "AN1",
      before: "analytics (today's overview: heatmap + most-used tools)",
    });
  });

  it("name a task of the plan and either an existing screen or a new-surface baseline", () => {
    const activeScreens = new Set(splitByActivation(expandScenarios()).active.map((s) => s.screen.id));
    for (const screen of LATER_SCREENS) {
      expect(PLAN_TASKS.has(screen.activatesWith), screen.id).toBe(true);
      const oldPair = screen.before.split(" ")[0];
      expect(screen.before === "new-surface" || activeScreens.has(oldPair), `${screen.id}: before "${screen.before}"`).toBe(true);
    }
  });

  it("covers the plan's (b) list", () => {
    const ids = LATER_SCREENS.map((s) => s.id);
    for (const id of ["analytics-activity", "session-detail-sheet", "journey-evidence", "file-history"]) expect(ids).toContain(id);
  });
});
