// Baseline freeze aggregation (plan I0): D "before" values from probes.

import { describe, expect, it } from "vitest";
import { aggregateBefore, scrubPaths } from "../lib/baseline.mjs";

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
});
