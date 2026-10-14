// C4 measurement state: the seed matches the declared state, the matrix
// declares the collapsed / one-expanded pair, and drift fails a scenario.

import { describe, expect, it } from "vitest";
import { checkMeasurementState } from "../lib/probes.mjs";
import { MEASUREMENT_STATE, STORAGE_SEED, expandScenarios } from "../scenarios.mjs";

const measured = {
  sidebarWidth: 260,
  rootFontSize: 16,
  inspectorOpenStored: "false",
  sessionsLayout: "inline",
  selectedProjects: 0,
  expandedProjects: 0,
};

describe("measurement state", () => {
  it("is sidebar 260px, scale 100%, inspector closed, one tab", () => {
    expect(MEASUREMENT_STATE).toEqual({ sidebarWidthPx: 260, fontScalePercent: 100, inspectorOpen: false, tabs: 1 });
    expect(STORAGE_SEED).toEqual({ "sidebar-width": "260", "navigator-open": "false" });
  });

  it("declares the collapsed / one-expanded project-row pair at 1440x900", () => {
    const ids = expandScenarios().map((s) => s.id);
    expect(ids).toContain("projects-collapsed--1440x900--dark");
    expect(ids).toContain("projects-expanded--1440x900--dark");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("accepts the expected state and rejects drift", () => {
    expect(checkMeasurementState(measured, MEASUREMENT_STATE, { mobile: false })).toEqual([]);
    expect(checkMeasurementState({ ...measured, sidebarWidth: 256 }, MEASUREMENT_STATE, { mobile: false })).toEqual([
      "sidebar 256px, expected 260px",
    ]);
    expect(checkMeasurementState({ ...measured, inspectorOpenStored: null }, MEASUREMENT_STATE, { mobile: false })).toHaveLength(1);
    expect(checkMeasurementState({ ...measured, rootFontSize: 17.6 }, MEASUREMENT_STATE, { mobile: false })).toHaveLength(1);
  });

  it("does not judge the mobile drawer width", () => {
    expect(checkMeasurementState({ ...measured, sidebarWidth: 311 }, MEASUREMENT_STATE, { mobile: true })).toEqual([]);
  });
});
