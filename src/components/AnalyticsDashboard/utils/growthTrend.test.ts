import { describe, expect, it } from "vitest";
import type { DailyStats } from "../../../types";
import type { GrowthTrend } from "../types";
import { calculateGrowthTrend } from "./calculations";
import { GROWTH_FLOORS, calculateDailyGrowth } from "./projectCalculations";

/**
 * The policy rows, expressed relative to an arbitrary per-metric floor so the
 * same table exercises every metric without depending on specific data.
 */
const policyRows = (
  floor: number,
): Array<{ name: string; previous: number; current: number; expected: GrowthTrend }> => {
  const smallBase = Math.floor(floor / 2);
  return [
    { name: "0 -> 0 shows nothing", previous: 0, current: 0, expected: { kind: "none" } },
    { name: "0 -> positive is new", previous: 0, current: smallBase, expected: { kind: "new" } },
    {
      name: "small base increase has no percentage",
      previous: smallBase,
      current: floor * 10,
      expected: { kind: "up-small-base" },
    },
    {
      name: "small base decrease has no percentage",
      previous: smallBase,
      current: Math.floor(smallBase / 2),
      expected: { kind: "down-small-base" },
    },
    {
      name: "small base unchanged is flat",
      previous: smallBase,
      current: smallBase,
      expected: { kind: "flat" },
    },
    {
      name: "previous just below the floor is still a small base",
      previous: floor - 1,
      current: floor * 2,
      expected: { kind: "up-small-base" },
    },
    {
      name: "previous at the floor shows the percentage",
      previous: floor,
      current: floor * 2,
      expected: { kind: "pct", value: 100 },
    },
    {
      name: "previous above the floor keeps the percentage (x5 = +400%)",
      previous: floor * 5,
      current: floor * 25,
      expected: { kind: "pct", value: 400 },
    },
    {
      name: "previous above the floor reports a decrease",
      previous: floor * 4,
      current: floor,
      expected: { kind: "pct", value: -75 },
    },
    {
      name: "previous above the floor unchanged is 0%",
      previous: floor * 3,
      current: floor * 3,
      expected: { kind: "pct", value: 0 },
    },
  ];
};

describe("calculateGrowthTrend", () => {
  describe.each([3, 20, 10_000])("with floor %i", (floor) => {
    it.each(policyRows(floor))("$name", ({ previous, current, expected }) => {
      expect(calculateGrowthTrend(current, previous, floor)).toEqual(expected);
    });
  });

  it("rounds percentages and never reports -0", () => {
    expect(calculateGrowthTrend(301, 300, 20)).toEqual({ kind: "pct", value: 0 });
    expect(calculateGrowthTrend(299, 300, 20)).toEqual({ kind: "pct", value: 0 });
    expect(Object.is((calculateGrowthTrend(299, 300, 20) as { value: number }).value, -0)).toBe(
      false,
    );
    expect(calculateGrowthTrend(200, 30, 20)).toEqual({ kind: "pct", value: 567 });
  });
});

const day = (
  date: string,
  values: Partial<Pick<DailyStats, "message_count" | "total_tokens">>,
): DailyStats => ({
  date,
  total_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  message_count: 0,
  session_count: 1,
  active_hours: 1,
  ...values,
});

const metrics = [
  {
    metric: "messages",
    floor: GROWTH_FLOORS.messages,
    field: "message_count",
    pick: (g: ReturnType<typeof calculateDailyGrowth>) => g.messageGrowth,
  },
  {
    metric: "tokens",
    floor: GROWTH_FLOORS.tokens,
    field: "total_tokens",
    pick: (g: ReturnType<typeof calculateDailyGrowth>) => g.tokenGrowth,
  },
] as const;

describe("GROWTH_FLOORS", () => {
  it("uses the approved per-metric floors", () => {
    expect(GROWTH_FLOORS).toEqual({ messages: 20, tokens: 10_000 });
  });
});

describe("calculateDailyGrowth", () => {
  describe.each(metrics)("$metric (floor $floor)", ({ floor, field, pick }) => {
    it.each(policyRows(floor))("$name", ({ previous, current, expected }) => {
      const growth = calculateDailyGrowth([
        day("2026-01-01", { [field]: floor * 100 }),
        day("2026-01-02", { [field]: previous }),
        day("2026-01-03", { [field]: current }),
      ]);
      expect(pick(growth)).toEqual(expected);
    });
  });

  it("shows nothing for either metric with fewer than two days", () => {
    const none: GrowthTrend = { kind: "none" };
    expect(calculateDailyGrowth([])).toEqual({ tokenGrowth: none, messageGrowth: none });
    expect(
      calculateDailyGrowth([day("2026-01-01", { message_count: 500, total_tokens: 500_000 })]),
    ).toEqual({ tokenGrowth: none, messageGrowth: none });
  });

  it("compares against the calendar day before the last day, not an older recorded day", () => {
    // daily_stats is sparse: days without activity have no row.
    const growth = calculateDailyGrowth([
      day("2026-01-01", { message_count: 22, total_tokens: 600_000 }),
      day("2026-01-05", { message_count: 1_369, total_tokens: 44_000_000 }),
    ]);
    expect(growth).toEqual({ messageGrowth: { kind: "new" }, tokenGrowth: { kind: "new" } });
  });

  it("uses the previous calendar day across a month boundary", () => {
    const growth = calculateDailyGrowth([
      day("2026-02-28", { message_count: 100, total_tokens: 100_000 }),
      day("2026-03-01", { message_count: 150, total_tokens: 50_000 }),
    ]);
    expect(growth).toEqual({
      messageGrowth: { kind: "pct", value: 50 },
      tokenGrowth: { kind: "pct", value: -50 },
    });
  });

  it("applies each metric's own floor independently", () => {
    // 15 messages is below the message floor; 15,000 tokens is above the token floor.
    const growth = calculateDailyGrowth([
      day("2026-01-01", { message_count: 15, total_tokens: 15_000 }),
      day("2026-01-02", { message_count: 3_000, total_tokens: 30_000 }),
    ]);
    expect(growth.messageGrowth).toEqual({ kind: "up-small-base" });
    expect(growth.tokenGrowth).toEqual({ kind: "pct", value: 100 });
  });
});
