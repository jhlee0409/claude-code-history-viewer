import { describe, expect, it } from "vitest";
import type { SessionComparison } from "../../../types";
import { formatPercent } from "@/lib/format/number";
import { calculateSessionComparisonMetrics } from "./sessionCalculations";

const comparison = (rank_by_tokens: number, is_above_average = true) =>
  ({ rank_by_tokens, is_above_average }) as unknown as SessionComparison;

describe("calculateSessionComparisonMetrics", () => {
  it("gives the percentile as the share of sessions ranked below (0-1), for formatPercent", () => {
    expect(calculateSessionComparisonMetrics(comparison(1), 4).percentileRatio).toBe(0.75);
    expect(calculateSessionComparisonMetrics(comparison(4), 4).percentileRatio).toBe(0);
    expect(calculateSessionComparisonMetrics(comparison(1), 0).percentileRatio).toBe(0);
  });

  it("never shows a partial share as 100% or a non-zero one as 0%", () => {
    // Rank 1 of 250 sessions: 249 of 250 rank below. Rounded by hand this read 100%.
    expect(formatPercent(calculateSessionComparisonMetrics(comparison(1), 250).percentileRatio, "en")).toBe(">99%");
    // Rank 249 of 250: one session ranks below. Rounded by hand this read 0%.
    expect(formatPercent(calculateSessionComparisonMetrics(comparison(249), 250).percentileRatio, "en")).toBe("<1%");
    expect(formatPercent(calculateSessionComparisonMetrics(comparison(2), 3).percentileRatio, "en")).toBe("33%");
  });
});
