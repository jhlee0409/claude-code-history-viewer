import { describe, expect, it } from "vitest";
import { calculateRetirementImpact, type ModelUsageLike } from "./globalCalculations";

const today = new Date("2026-09-02T12:00:00Z");
const usage = (overrides: Partial<ModelUsageLike>): ModelUsageLike => ({
  model_name: "claude-sonnet-4-6",
  token_count: 2_000_000,
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_tokens: 0,
  cache_read_tokens: 0,
  ...overrides,
});

describe("calculateRetirementImpact", () => {
  it("re-prices retired usage at the recommended replacement", () => {
    const [row] = calculateRetirementImpact([usage({ model_name: "claude-opus-4-1" })], today);
    // opus-4-1: 15 + 75; replacement opus-4-8: 5 + 25
    expect(row).toMatchObject({ replacedBy: "claude-opus-4-8", currentCost: 90, replacementCost: 30 });
    expect(row?.lifecycle.status).toBe("retired");
  });

  it("includes models retiring inside the notice window", () => {
    const [row] = calculateRetirementImpact([usage({ model_name: "o4-mini" })], today);
    expect(row?.lifecycle.status).toBe("retiring");
    expect(row?.replacedBy).toBe("gpt-5.6-terra");
  });

  it("skips active models, models without a replacement, and unknown ids", () => {
    expect(
      calculateRetirementImpact(
        [usage({ model_name: "claude-sonnet-4-6" }), usage({ model_name: "grok-4" }), usage({ model_name: "nope" })],
        today,
      ),
    ).toEqual([]);
  });

  it("skips subscription providers whose current cost cannot be estimated", () => {
    expect(calculateRetirementImpact([usage({ model_name: "gpt-5-codex", provider_id: "copilot" })], today)).toEqual([]);
  });

  it("ignores source-reported cost so both sides use API rates", () => {
    const [row] = calculateRetirementImpact([usage({ model_name: "gpt-5-codex", cost_usd: 0.01 })], today);
    expect(row?.currentCost).toBeCloseTo(11.25);
  });

  it("orders rows by current cost, largest first", () => {
    const rows = calculateRetirementImpact(
      [usage({ model_name: "o4-mini" }), usage({ model_name: "claude-opus-4-1" })],
      today,
    );
    expect(rows.map((r) => r.modelName)).toEqual(["claude-opus-4-1", "o4-mini"]);
  });
});
