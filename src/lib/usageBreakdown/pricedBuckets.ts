/**
 * Partial-cost policy, frontend half (ADR 0002 §5).
 *
 * Priced buckets go straight into the existing `calculateGlobalCostSummary`:
 * a `source` bucket carries its provider-reported `cost_usd`, an `estimate`
 * bucket is priced from the price table. No new price function exists.
 */

import {
  calculateGlobalCostSummary,
  type GlobalCostSummary,
  type ModelUsageLike,
} from "@/components/AnalyticsDashboard/utils/globalCalculations";
import type { PricedModelStats } from "@/types/usageBreakdown";

/** Bucket stats as cost inputs; an estimate bucket never carries a cost. */
export const toCostInputs = (buckets: readonly PricedModelStats[]): ModelUsageLike[] =>
  buckets.map(({ pricing_source, stats }) =>
    pricing_source === "estimate" ? { ...stats, cost_usd: null } : stats,
  );

/** `exactCost` = provider-reported part, `estimatedCost` = price-table part. */
export const summarizeBucketCost = (
  buckets: readonly PricedModelStats[],
  totalTokens: number,
): GlobalCostSummary => calculateGlobalCostSummary(toCostInputs(buckets), totalTokens);
