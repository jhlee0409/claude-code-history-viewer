/**
 * Partial-cost policy reference tests (ADR 0002 §5, plan C2).
 *
 * Uses the real `calculateGlobalCostSummary` (through `summarizeBucketCost`):
 * splitting priced buckets by day, turn or session never changes the total,
 * and the old merged group is pinned at $1 where the policy says $4 — the
 * same numbers as `scratch/inner-ui/probe/c2.probe.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { calculateGlobalCostSummary } from "@/components/AnalyticsDashboard/utils/globalCalculations";
import type { ModelContextStats, ModelStats } from "@/types";
import type { PricedModelStats } from "@/types/usageBreakdown";
import { summarizeBucketCost, toCostInputs } from "./pricedBuckets";

const SONNET = "claude-sonnet-4-5-20250929";

type Classes = Pick<
  ModelContextStats,
  "input_tokens" | "output_tokens" | "cache_read_tokens" | "reasoning_tokens"
> & { cache_5m: number; cache_1h: number };

const ZERO: Classes = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  reasoning_tokens: 0,
  cache_5m: 0,
  cache_1h: 0,
};

const context = (min: number, c: Partial<Classes>): ModelContextStats => {
  const v = { ...ZERO, ...c };
  const cacheCreation = v.cache_5m + v.cache_1h;
  return {
    min_context_tokens: min,
    token_count:
      v.input_tokens + v.output_tokens + cacheCreation + v.cache_read_tokens + v.reasoning_tokens,
    input_tokens: v.input_tokens,
    output_tokens: v.output_tokens,
    cache_creation_tokens: cacheCreation,
    cache_creation_tokens_5m: v.cache_5m,
    cache_creation_tokens_1h: v.cache_1h,
    cache_read_tokens: v.cache_read_tokens,
    reasoning_tokens: v.reasoning_tokens,
  };
};

const stats = (
  model: string,
  breakdown: ModelContextStats[],
  extra: Partial<ModelStats> = {},
): ModelStats => {
  const sum = (k: keyof ModelContextStats) =>
    breakdown.reduce((acc, b) => acc + ((b[k] as number | undefined) ?? 0), 0);
  return {
    model_name: model,
    provider_id: "claude",
    message_count: breakdown.length,
    token_count: sum("token_count"),
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    cache_creation_tokens: sum("cache_creation_tokens"),
    cache_read_tokens: sum("cache_read_tokens"),
    reasoning_tokens: sum("reasoning_tokens"),
    context_breakdown: breakdown,
    ...extra,
  };
};

const source = (s: ModelStats, cost: number): PricedModelStats => ({
  pricing_source: "source",
  stats: { ...s, cost_usd: cost },
});
const estimate = (s: ModelStats): PricedModelStats => ({ pricing_source: "estimate", stats: s });

const tokens = (buckets: PricedModelStats[]) =>
  buckets.reduce((acc, b) => acc + b.stats.token_count, 0);

const total = (buckets: PricedModelStats[]) => summarizeBucketCost(buckets, tokens(buckets));

const oneMillionInput = () => stats(SONNET, [context(0, { input_tokens: 1_000_000 })]);

describe("mixed source cost (C2 counterexample)", () => {
  const dayA = [source(oneMillionInput(), 1)];
  const dayB = [estimate(oneMillionInput())];

  it("prices each day under the policy: $1 exact + $3 estimated", () => {
    expect(total(dayA)).toMatchObject({ totalEstimatedCost: 1, exactCost: 1, estimatedCost: 0 });
    expect(total(dayB).totalEstimatedCost).toBeCloseTo(3, 12);
    expect(total(dayB).exactCost).toBe(0);
  });

  it("date sum = range sum = $4 (1 exact + 3 estimated)", () => {
    const range = total([...dayA, ...dayB]);
    const daySum = total(dayA).totalEstimatedCost + total(dayB).totalEstimatedCost;
    expect(range.totalEstimatedCost).toBeCloseTo(4, 12);
    expect(daySum).toBeCloseTo(range.totalEstimatedCost, 12);
    expect(range.exactCost).toBe(1);
    expect(range.estimatedCost).toBeCloseTo(3, 12);
  });

  it("two turns of one day keep two buckets and also total $4", () => {
    const sameDay = [source(oneMillionInput(), 1), estimate(oneMillionInput())];
    expect(total(sameDay).totalEstimatedCost).toBeCloseTo(4, 12);
  });

  it("the old merged group (tokens of both rows, cost of one) prices at $1", () => {
    const merged = stats(SONNET, [context(0, { input_tokens: 2_000_000 })], { cost_usd: 1 });
    expect(calculateGlobalCostSummary([merged], merged.token_count).totalEstimatedCost).toBe(1);
  });
});

describe("estimate is additive across bucket splits", () => {
  const cases: Array<{ name: string; model: string; extra: Partial<ModelStats>; long: number }> = [
    // Long-context tier above 100k plus 5m/1h cache writes.
    { name: "Claude context tiers + 1h cache", model: "claude-haiku-5-5", extra: {}, long: 100_001 },
    // Service tier with its own context tiers.
    {
      name: "OpenAI fast tier + context tier",
      model: "gpt-6-sol",
      extra: { provider_id: "codex", service_tier: "fast" },
      long: 272_000,
    },
  ];

  for (const { name, model, extra, long } of cases) {
    it(name, () => {
      const partA = stats(
        model,
        [
          context(0, { input_tokens: 120_000, output_tokens: 3_000, cache_5m: 9_000, cache_1h: 1_000, reasoning_tokens: 700 }),
          context(long, { input_tokens: 300_000, cache_read_tokens: 50_000, cache_1h: 4_000 }),
        ],
        extra,
      );
      const partB = stats(
        model,
        [
          context(0, { input_tokens: 80_000, output_tokens: 1_000, cache_read_tokens: 20_000, cache_5m: 500 }),
          context(long, { input_tokens: 150_000, output_tokens: 6_000, reasoning_tokens: 300 }),
        ],
        extra,
      );
      const merged = stats(
        model,
        [
          context(0, {
            input_tokens: 200_000,
            output_tokens: 4_000,
            cache_read_tokens: 20_000,
            cache_5m: 9_500,
            cache_1h: 1_000,
            reasoning_tokens: 700,
          }),
          context(long, {
            input_tokens: 450_000,
            output_tokens: 6_000,
            cache_read_tokens: 50_000,
            cache_1h: 4_000,
            reasoning_tokens: 300,
          }),
        ],
        extra,
      );
      const split = total([estimate(partA)]).totalEstimatedCost + total([estimate(partB)]).totalEstimatedCost;
      const once = total([estimate(merged)]);
      expect(once.totalEstimatedCost).toBeGreaterThan(0);
      expect(split).toBeCloseTo(once.totalEstimatedCost, 9);
      expect(total([estimate(partA), estimate(partB)]).totalEstimatedCost).toBeCloseTo(
        once.totalEstimatedCost,
        9,
      );
    });
  }

  it("coverage numerator and unpriced tokens add up across splits", () => {
    const unpriced = (n: number) =>
      estimate(stats("model-without-price", [context(0, { input_tokens: n })], { provider_id: "opencode" }));
    const priced = (n: number) => estimate(stats(SONNET, [context(0, { input_tokens: n })]));
    const a = [priced(100), unpriced(40)];
    const b = [priced(60), unpriced(10)];
    const sa = total(a);
    const sb = total(b);
    const range = total([...a, ...b]);
    expect(sa.coveredTokens + sb.coveredTokens).toBe(range.coveredTokens);
    expect(sa.unpricedTokens + sb.unpricedTokens).toBe(range.unpricedTokens);
    expect(range).toMatchObject({ coveredTokens: 160, unpricedTokens: 50 });
  });
});

describe("toCostInputs", () => {
  it("drops a cost that an estimate bucket should never carry", () => {
    const wrong = estimate({ ...oneMillionInput(), cost_usd: 0.01 });
    expect(toCostInputs([wrong])[0]?.cost_usd).toBeNull();
    expect(total([wrong]).totalEstimatedCost).toBeCloseTo(3, 12);
  });

  it("keeps a source bucket's reported cost", () => {
    expect(toCostInputs([source(oneMillionInput(), 0.5)])[0]?.cost_usd).toBe(0.5);
  });
});
