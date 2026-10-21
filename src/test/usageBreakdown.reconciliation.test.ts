/**
 * Usage-breakdown reconciliation against the real command (ADR 0002 §8).
 *
 * `usageBreakdown.reconciliation.json` is written by the Rust test
 * `usage_breakdown::golden_tests` from the real `get_usage_breakdown`
 * command on small fixtures (and fails there when the command's output
 * changes). Here the same responses are priced with the existing
 * `calculateGlobalCostSummary` (through `summarizeBucketCost`) and their
 * requests are compared with `localDayIntervals`.
 */

import { describe, expect, it } from "vitest";
import golden from "./fixtures/usageBreakdown.reconciliation.json";
import { calculateGlobalCostSummary } from "@/components/AnalyticsDashboard/utils/globalCalculations";
import { localDayIntervals } from "@/lib/usageBreakdown/localDayIntervals";
import { summarizeBucketCost } from "@/lib/usageBreakdown/pricedBuckets";
import type { ModelStats } from "@/types";
import type {
  PricedModelStats,
  UsageBreakdownRequest,
  UsageBreakdownResponse,
} from "@/types/usageBreakdown";

interface Scenario {
  request: UsageBreakdownRequest;
  response: UsageBreakdownResponse;
  legacy_model_distribution: ModelStats[];
  /** The backend's ranking cost of each listed session (ADR 0003). */
  ranking_costs: number[];
}

/** One fixture over a small cap, and the same request uncut (ADR 0003). */
interface CapScenario {
  max_sessions: number;
  request: UsageBreakdownRequest;
  response: UsageBreakdownResponse;
  uncapped_response: UsageBreakdownResponse;
  ranking_costs: number[];
}

type ScenarioName = Exclude<keyof typeof golden.scenarios, "session_cap">;

const scenario = (name: ScenarioName): Scenario =>
  golden.scenarios[name] as unknown as Scenario;

const capScenario = (): CapScenario => golden.scenarios.session_cap as unknown as CapScenario;

const scenarioNames = (): ScenarioName[] =>
  (Object.keys(golden.scenarios) as (keyof typeof golden.scenarios)[]).filter(
    (name): name is ScenarioName => name !== "session_cap",
  );

const tokensOf = (buckets: readonly PricedModelStats[]) =>
  buckets.reduce((sum, b) => sum + b.stats.token_count, 0);

const costOf = (buckets: readonly PricedModelStats[]) =>
  summarizeBucketCost(buckets, tokensOf(buckets));

const intervalBuckets = (response: UsageBreakdownResponse) =>
  response.intervals.flatMap((i) => i.models);

const sessionBuckets = (response: UsageBreakdownResponse) =>
  response.sessions.flatMap((s) => s.models);

describe("reconciliation against the new command", () => {
  it("interval sum = range counted once = session sum, tokens and cost (bucket policy)", () => {
    const days = scenario("same_policy_days").response;
    const range = scenario("same_policy_range").response;
    expect(range.intervals).toHaveLength(1);

    const byDays = intervalBuckets(days);
    const once = intervalBuckets(range);
    const bySessions = sessionBuckets(days);
    expect(tokensOf(byDays)).toBe(tokensOf(once));
    expect(tokensOf(bySessions)).toBe(tokensOf(once));

    const perDay = days.intervals.reduce((sum, i) => sum + costOf(i.models).totalEstimatedCost, 0);
    const perSession = days.sessions.reduce((sum, s) => sum + costOf(s.models).totalEstimatedCost, 0);
    const rangeCost = costOf(once);
    expect(rangeCost.totalEstimatedCost).toBeGreaterThan(0);
    expect(rangeCost.exactCost).toBeCloseTo(0.75, 12);
    expect(perDay).toBeCloseTo(rangeCost.totalEstimatedCost, 9);
    expect(perSession).toBeCloseTo(rangeCost.totalEstimatedCost, 9);
    expect(costOf(byDays).exactCost).toBeCloseTo(rangeCost.exactCost, 12);
  });

  it("mixed source cost by day → summarizeBucketCost = $4 (1 exact + 3 estimated); old summary = $1", () => {
    const { response, legacy_model_distribution } = scenario("mixed_by_day");
    const [dayA, dayB] = response.intervals;
    expect(dayA!.models.map((m) => m.pricing_source)).toEqual(["source"]);
    expect(dayB!.models.map((m) => m.pricing_source)).toEqual(["estimate"]);

    const range = costOf(intervalBuckets(response));
    expect(range.totalEstimatedCost).toBeCloseTo(4, 12);
    expect(range.exactCost).toBe(1);
    expect(range.estimatedCost).toBeCloseTo(3, 12);

    const legacyTokens = legacy_model_distribution.reduce((sum, m) => sum + m.token_count, 0);
    expect(legacyTokens).toBe(tokensOf(intervalBuckets(response)));
    expect(calculateGlobalCostSummary(legacy_model_distribution, legacyTokens).totalEstimatedCost).toBe(1);
  });

  it("mixed source cost by turn in one day → two buckets, $4", () => {
    const { response } = scenario("mixed_by_turn");
    const day = response.intervals[0]!;
    expect(day.models.map((m) => m.pricing_source).sort()).toEqual(["estimate", "source"]);
    expect(costOf(day.models).totalEstimatedCost).toBeCloseTo(4, 12);
    expect(costOf(response.sessions[0]!.models).totalEstimatedCost).toBeCloseTo(4, 12);
  });

  it("localDayIntervals(Kolkata) request puts 18:20Z and 18:40Z rows on different days", () => {
    const { request, response } = scenario("kolkata");
    expect(localDayIntervals({ from: "2026-10-17", to: "2026-10-18" }, "Asia/Kolkata")).toEqual(
      request.intervals,
    );
    expect(response.intervals.map((i) => [i.key, i.message_count, tokensOf(i.models)])).toEqual([
      ["2026-10-17", 1, 10],
      ["2026-10-18", 1, 20],
    ]);
  });

  it("Apia 2011-12-30 zero-length interval is returned with zero usage", () => {
    const { request, response } = scenario("apia");
    expect(localDayIntervals({ from: "2011-12-29", to: "2011-12-31" }, "Pacific/Apia")).toEqual(
      request.intervals,
    );
    const skipped = request.intervals[1]!;
    expect(skipped.start_utc).toBe(skipped.end_utc);
    expect(response.intervals.map((i) => i.key)).toEqual(["2011-12-29", "2011-12-30", "2011-12-31"]);
    expect(response.intervals[1]).toEqual({
      key: "2011-12-30",
      models: [],
      message_count: 0,
      session_count: 0,
    });
    expect(tokensOf(intervalBuckets(response))).toBe(30);
  });

  it("undated rows only change coverage.undated_rows", () => {
    const withUndated = scenario("undated").response;
    const without = scenario("undated_removed").response;
    expect(withUndated.coverage.undated_rows).toBe(1);
    expect(without.coverage.undated_rows).toBe(0);
    const strip = (r: UsageBreakdownResponse) => ({
      ...r,
      coverage: { ...r.coverage, undated_rows: 0 },
    });
    expect(strip(withUndated)).toEqual(strip(without));
    // The old summary stamps the undated row with "now" and counts it.
    const legacyTokens = scenario("undated").legacy_model_distribution.reduce(
      (sum, m) => sum + m.token_count,
      0,
    );
    expect(legacyTokens - tokensOf(intervalBuckets(withUndated))).toBe(7);
  });
});

describe("session cap and ranking (ADR 0003)", () => {
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

  it("an uncut response lists every session with an all-zero remainder row", () => {
    for (const name of scenarioNames()) {
      expect(scenario(name).response.session_remainder, name).toEqual({
        models: [],
        message_count: 0,
        session_count: 0,
      });
    }
  });

  it("listed sessions + remainder = intervals: tokens, messages and cost to the cent", () => {
    const { response, max_sessions } = capScenario();
    const remainder = response.session_remainder;
    expect(response.sessions).toHaveLength(max_sessions);
    expect(remainder.session_count).toBeGreaterThan(0);

    const listedAndRest = [...sessionBuckets(response), ...remainder.models];
    const intervals = intervalBuckets(response);
    expect(tokensOf(listedAndRest)).toBe(tokensOf(intervals));
    expect(sum(response.sessions.map((s) => s.message_count)) + remainder.message_count).toBe(
      sum(response.intervals.map((i) => i.message_count)),
    );

    const split = costOf(listedAndRest);
    const whole = costOf(intervals);
    expect(whole.exactCost).toBeGreaterThan(0);
    expect(whole.estimatedCost).toBeGreaterThan(0);
    expect(whole.unpricedTokens).toBeGreaterThan(0);
    for (const part of ["totalEstimatedCost", "exactCost", "estimatedCost"] as const) {
      expect(split[part], part).toBeCloseTo(whole[part], 9);
    }
    expect(split.unpricedTokens).toBe(whole.unpricedTokens);
    // Priced one row at a time, as the overview's session table will.
    const perRow = sum(response.sessions.map((s) => costOf(s.models).totalEstimatedCost));
    expect(perRow + costOf(remainder.models).totalEstimatedCost).toBeCloseTo(
      whole.totalEstimatedCost,
      9,
    );
  });

  it("the remainder merges the cut sessions and keeps source and estimate apart", () => {
    const { response, uncapped_response, max_sessions } = capScenario();
    expect(response.sessions).toEqual(uncapped_response.sessions.slice(0, max_sessions));
    const cut = uncapped_response.sessions.slice(max_sessions);
    const remainder = response.session_remainder;
    expect(remainder.session_count).toBe(cut.length);
    expect(remainder.message_count).toBe(sum(cut.map((s) => s.message_count)));
    const cutBuckets = cut.flatMap((s) => s.models);
    expect(tokensOf(remainder.models)).toBe(tokensOf(cutBuckets));
    expect(costOf(remainder.models).totalEstimatedCost).toBeCloseTo(
      costOf(cutBuckets).totalEstimatedCost,
      12,
    );
    const sonnet = remainder.models
      .filter((m) => m.stats.model_name === "claude-sonnet-4-5-20250929")
      .map((m) => m.pricing_source)
      .sort();
    expect(sonnet).toEqual(["estimate", "source"]);
  });

  it("the backend's ranking cost equals summarizeBucketCost for every listed session", () => {
    const checked: [string, UsageBreakdownResponse, number[]][] = [
      ...scenarioNames().map((name): [string, UsageBreakdownResponse, number[]] => [
        name,
        scenario(name).response,
        scenario(name).ranking_costs,
      ]),
      ["session_cap", capScenario().uncapped_response, capScenario().ranking_costs],
    ];
    for (const [name, response, rankingCosts] of checked) {
      expect(rankingCosts, name).toHaveLength(response.sessions.length);
      response.sessions.forEach((session, index) => {
        expect(rankingCosts[index], `${name} #${index}`).toBeCloseTo(
          costOf(session.models).totalEstimatedCost,
          12,
        );
      });
    }
  });

  it("sessions come in the frontend's cost order, not token order", () => {
    const sessions = capScenario().uncapped_response.sessions;
    const ranked = sessions.map((s) => ({
      cost: costOf(s.models).totalEstimatedCost,
      tokens: tokensOf(s.models),
      lastTs: s.last_ts,
    }));
    for (let i = 1; i < ranked.length; i += 1) {
      const [a, b] = [ranked[i - 1]!, ranked[i]!];
      const inOrder =
        a.cost > b.cost ||
        (a.cost === b.cost && (a.tokens > b.tokens || (a.tokens === b.tokens && a.lastTs >= b.lastTs)));
      expect(inOrder, `#${i - 1} before #${i}`).toBe(true);
    }
    const byTokens = [...ranked].sort((a, b) => b.tokens - a.tokens);
    expect(byTokens).not.toEqual(ranked);
  });
});
