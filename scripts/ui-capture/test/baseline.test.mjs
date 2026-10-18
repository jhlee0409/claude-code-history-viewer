// Baseline freeze aggregation (plan I0): D "before" values from probes.

import { describe, expect, it } from "vitest";
import { aggregateBefore, replaceProbe, scrubPaths } from "../lib/baseline.mjs";

const scenario = (inner) => ({ inner });

describe("aggregateBefore", () => {
  const probes = {
    "transcript--1440x900--dark": scenario({
      absPathLeaks: { applicable: true, population: 10, selector: "body", value: { leaks: 3 } },
      toolRowMetrics: { applicable: true, population: 2, selector: "rows", value: { fontSizes: { 12: 2 }, minHeight: 24.8, truncatedRows: 0 } },
      wordBreak: { applicable: true, population: 4, selector: "cjk", value: { byLang: { ko: { total: 4, keepAll: 1 } } } },
      motionActivity: { applicable: false, population: null, selector: null, value: null },
    }),
    "home--1440x900--dark": scenario({
      absPathLeaks: { applicable: false, population: null, selector: null, value: null },
      focusVisible: { applicable: true, population: 18, selector: "tab", value: { visible: 11, invisible: 7 } },
    }),
    "board--390x844--dark": scenario({
      overflowX: { applicable: true, population: 100, selector: "body *", value: { pageOverflowPx: 33, clipped: 1 } },
      cards: { applicable: true, population: 0, selector: "main *", value: { cards: 0, maxNesting: 0, radii: {} } },
    }),
  };
  const before = aggregateBefore(probes);

  it("sums values over the scenarios where a probe applied", () => {
    expect(before.D1.value).toEqual({ leaks: 3, scenariosWithLeaks: 1 });
    expect(before.D1.scenarios).toBe(1);
    expect(before.D2.value.fontSizePx).toEqual({ 12: 2 });
    expect(before.D7.value).toEqual({ visible: 11, stops: 18, invisible: 7 });
    expect(before.D12.wordBreak.value.ko).toEqual({ total: 4, keepAll: 1, keepAllShare: 0.25 });
    expect(before.D25.value.mobileScenariosWithPageOverflow).toEqual(["board--390x844--dark (33px)"]);
  });

  it("names scenarios with an empty population", () => {
    expect(before.D20.cards.emptyPopulation).toEqual(["board--390x844--dark"]);
  });

  it("scrubs machine roots from examples", () => {
    expect(scrubPaths({ a: ["/Users/me/repo/x", "/Users/me/y"] }, [["/Users/me/repo", "<repo>"], ["/Users/me", "~"]])).toEqual({ a: ["<repo>/x", "~/y"] });
  });

  it("D20 leftEdges: counts scenarios aligned within ±2px (plan §8 D20)", () => {
    const left = (delta) => ({ leftEdges: { applicable: true, population: 5, selector: "main", value: { delta, distinctEdges: 3 } } });
    const d20 = aggregateBefore({ a: scenario(left(0)), b: scenario(left(50)), c: scenario(left(-2)) }).D20.leftEdges.value;
    expect(d20.titleToContentDeltaPx).toEqual({ a: 0, b: 50, c: -2 });
    expect(d20.alignedWithin2px).toBe(2);
  });
});

describe("replaceProbe (re-freeze one probe's before-values)", () => {
  const entry = (probe, scenarios, value) => ({ probe, selector: "s", scenarios, population: 1, emptyPopulation: [], value });
  const frozen = { D1: entry("absPathLeaks", 3, { leaks: 9 }), D20: { cards: entry("cards", 2, { cards: 4 }), leftEdges: entry("leftEdges", 2, { old: true }) } };

  it("replaces only the entries measured by that probe and says where", () => {
    const fresh = { D1: entry("absPathLeaks", 3, { leaks: 0 }), D20: { cards: entry("cards", 2, { cards: 1 }), leftEdges: entry("leftEdges", 2, { new: true }) } };
    const { before, replaced } = replaceProbe(frozen, fresh, "leftEdges");
    expect(replaced).toEqual(["D20.leftEdges"]);
    expect(before.D20.leftEdges.value).toEqual({ new: true });
    expect(before.D20.cards.value).toEqual({ cards: 4 }); // untouched
    expect(before.D1.value).toEqual({ leaks: 9 });
    expect(frozen.D20.leftEdges.value).toEqual({ old: true }); // input not mutated
  });

  it("refuses a run that measured the probe on a different number of scenarios", () => {
    const fresh = { D20: { leftEdges: entry("leftEdges", 1, {}) } };
    expect(() => replaceProbe(frozen, fresh, "leftEdges")).toThrow(/frozen on 2 scenarios.*measured 1/);
  });

  it("refuses a probe the frozen baseline does not have", () => {
    expect(() => replaceProbe(frozen, frozen, "nope")).toThrow(/no frozen entry/);
  });
});
