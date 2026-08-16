import { describe, expect, it } from "vitest";
import {
  calculateGlobalCostSummary,
  calculateModelMetrics,
  type ModelUsageLike,
} from "./globalCalculations";

const usage = (overrides: Partial<ModelUsageLike>): ModelUsageLike => ({
  model_name: "gpt-5.6-terra",
  provider_id: "codex",
  token_count: 2_000_000,
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  ...overrides,
});

describe("global cost calculations", () => {
  it("keeps unknown model usage visible without inventing a price", () => {
    const summary = calculateGlobalCostSummary(
      [usage({ model_name: "provider/private-model", token_count: 100 })],
      100,
    );

    expect(summary.totalEstimatedCost).toBe(0);
    expect(summary.estimatedCost).toBe(0);
    expect(summary.exactCost).toBe(0);
    expect(summary.coveredTokens).toBe(0);
    expect(summary.unpricedTokens).toBe(100);
    expect(summary.unpricedModels).toBe(1);
  });

  it("prefers a provider-reported zero cost over an estimate", () => {
    const summary = calculateGlobalCostSummary(
      [usage({ cost_usd: 0 })],
      2_000_000,
    );
    const metrics = calculateModelMetrics(
      "provider/private-model",
      2_000_000,
      1_000_000,
      1_000_000,
      0,
      0,
      2_000_000,
      { sourceCostUSD: 0, providerId: "opencode" },
    );

    expect(summary.totalEstimatedCost).toBe(0);
    expect(summary.exactCost).toBe(0);
    expect(summary.coveredTokens).toBe(2_000_000);
    expect(summary.unpricedTokens).toBe(0);
    expect(metrics.price).toBe(0);
    expect(metrics.formattedPrice).toBe("$0.00");
    expect(metrics.pricingStatus).toBe("exact");
  });

  it("keeps estimated and source-reported costs separate", () => {
    const summary = calculateGlobalCostSummary(
      [
        usage({ cost_usd: 0.42 }),
        usage({
          model_name: "gemini-3-flash-preview",
          provider_id: "gemini",
          token_count: 2_000_000,
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
        }),
      ],
      4_000_000,
    );

    expect(summary.exactCost).toBeCloseTo(0.42);
    expect(summary.estimatedCost).toBeCloseTo(3.5);
    expect(summary.totalEstimatedCost).toBeCloseTo(3.92);
    expect(summary.coveragePercent).toBe(100);
  });

  it("includes separately reported reasoning in estimated cost", () => {
    const summary = calculateGlobalCostSummary(
      [
        usage({
          model_name: "gemini-3.1-flash-lite",
          provider_id: "gemini",
          token_count: 3_000_000,
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          reasoning_tokens: 1_000_000,
        }),
      ],
      3_000_000,
    );

    expect(summary.estimatedCost).toBeCloseTo(3.25);
  });

  it("marks a model row unavailable instead of showing a fallback estimate", () => {
    const metrics = calculateModelMetrics(
      "provider/private-model",
      1_000,
      1_000,
      0,
      0,
      0,
      1_000,
    );

    expect(metrics.formattedPrice).toBe("—");
    expect(metrics.pricingStatus).toBe("unavailable");
  });

  it("prices context buckets independently instead of applying a long tier to the aggregate", () => {
    const summary = calculateGlobalCostSummary(
      [usage({
        token_count: 800_000,
        input_tokens: 400_000,
        output_tokens: 400_000,
        context_breakdown: [
          {
            min_context_tokens: 0,
            token_count: 800_000,
            input_tokens: 400_000,
            output_tokens: 400_000,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            reasoning_tokens: 0,
          },
        ],
      })],
      800_000,
    );

    // 0.4M input at $2/M + 0.4M output at $12/M, all in the short tier.
    expect(summary.estimatedCost).toBeCloseTo(5.6);
  });

  it("keeps fast-tier rows separate from standard-tier rows", () => {
    const summary = calculateGlobalCostSummary(
      [usage({
        model_name: "gpt-5.3-codex",
        service_tier: "fast",
        token_count: 2_000_000,
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 0,
      })],
      2_000_000,
    );

    expect(summary.estimatedCost).toBeCloseTo(31.5);
  });

  it("returns unavailable for Cursor even when the model label is present", () => {
    const summary = calculateGlobalCostSummary(
      [usage({ model_name: "cursor", provider_id: "cursor", token_count: 1_000 })],
      1_000,
    );

    expect(summary.totalEstimatedCost).toBe(0);
    expect(summary.coveredTokens).toBe(0);
    expect(summary.unpricedTokens).toBe(1_000);
  });
});
