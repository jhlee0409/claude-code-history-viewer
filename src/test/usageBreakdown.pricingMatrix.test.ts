/**
 * Table-wide pricing drift matrix (AN0b review, ADR 0003 §3).
 *
 * `ranking.rs` mirrors the frontend's pricing to order sessions. The golden
 * reconciliation file pins that mirror on the sessions of a few scenarios;
 * this matrix pins it on every rate row of every model in
 * `src/data/model-pricing.json` — base rates, each context tier at and just
 * below its threshold, each service tier and its context tiers, a dated and
 * decorated name — plus the bucket rules (source cost, source-cost-only
 * providers, token-unsupported models, name forms).
 *
 * `pricing_matrix_tests.rs` writes the fixture with the Rust price of every
 * case; each case is rebuilt here and priced with `summarizeBucketCost`. Both
 * sides must produce the same f64. A price-table change regenerates it:
 * `CCHV_UPDATE_GOLDEN=1 cargo test --lib pricing_matrix -- --test-threads=1`.
 */
import { describe, expect, it } from "vitest";
import pricingTable from "@/data/model-pricing.json";
import { summarizeBucketCost } from "@/lib/usageBreakdown/pricedBuckets";
import type { ModelContextStats } from "@/types/stats.types";
import type { PricedModelStats } from "@/types/usageBreakdown";
import matrix from "./fixtures/usageBreakdown.pricingMatrix.json";

interface MatrixCase {
  rule: string;
  model: string;
  provider?: string;
  tier?: string;
  /** One context bucket per entry (its `min_context_tokens`); absent = totals only. */
  contexts?: number[];
  /** Absent = `estimate`. */
  pricing_source?: "source";
  cost_usd?: number;
  /** The Rust price; `null` = no price. */
  cost: number | null;
}

interface TableRow {
  contextTiers?: unknown[];
  serviceTiers?: Record<string, { contextTiers?: unknown[] }>;
}

const cases = matrix.cases as unknown as MatrixCase[];
const { tokens } = matrix;
const tokensPerBucket =
  tokens.input +
  tokens.output +
  tokens.cache_creation_5m +
  tokens.cache_creation_1h +
  tokens.cache_read +
  tokens.reasoning;

const contextBucket = (minContextTokens: number): ModelContextStats => ({
  min_context_tokens: minContextTokens,
  token_count: tokensPerBucket,
  input_tokens: tokens.input,
  output_tokens: tokens.output,
  cache_creation_tokens: tokens.cache_creation_5m + tokens.cache_creation_1h,
  cache_creation_tokens_5m: tokens.cache_creation_5m,
  cache_creation_tokens_1h: tokens.cache_creation_1h,
  cache_read_tokens: tokens.cache_read,
  reasoning_tokens: tokens.reasoning,
});

/** The bucket the Rust side priced: every context bucket holds `tokens`; the totals are their sum. */
const bucketOf = (c: MatrixCase): PricedModelStats => {
  const n = Math.max(c.contexts?.length ?? 0, 1);
  return {
    pricing_source: c.pricing_source ?? "estimate",
    stats: {
      model_name: c.model,
      ...(c.provider === undefined ? {} : { provider_id: c.provider }),
      ...(c.tier === undefined ? {} : { service_tier: c.tier }),
      message_count: 1,
      token_count: tokensPerBucket * n,
      input_tokens: tokens.input * n,
      output_tokens: tokens.output * n,
      cache_creation_tokens: (tokens.cache_creation_5m + tokens.cache_creation_1h) * n,
      cache_read_tokens: tokens.cache_read * n,
      reasoning_tokens: tokens.reasoning * n,
      ...(c.cost_usd === undefined ? {} : { cost_usd: c.cost_usd }),
      ...(c.contexts === undefined ? {} : { context_breakdown: c.contexts.map(contextBucket) }),
    },
  };
};

/** `summarizeBucketCost` of the one bucket: its price (`null` when unpriced) and the side it lands on. */
const frontendPrice = (c: MatrixCase): { price: number | null; onItsSide: boolean } => {
  const bucket = bucketOf(c);
  const summary = summarizeBucketCost([bucket], bucket.stats.token_count);
  if (summary.unpricedModels === 1) {
    return { price: null, onItsSide: summary.totalEstimatedCost === 0 };
  }
  const exact = c.pricing_source === "source" && c.cost_usd !== undefined;
  const side = exact ? summary.exactCost : summary.estimatedCost;
  return { price: summary.totalEstimatedCost, onItsSide: side === summary.totalEstimatedCost };
};

describe("pricing drift matrix: ranking.rs against summarizeBucketCost", () => {
  it("covers every model and tier of the price table (regenerate when this fails)", () => {
    const rows = Object.entries(pricingTable.models as Record<string, TableRow>);
    const serviceTiers = rows.flatMap(([, row]) => Object.values(row.serviceTiers ?? {}));
    expect(matrix.coverage).toEqual({
      models: rows.length,
      context_tiers: rows.reduce((n, [, row]) => n + (row.contextTiers?.length ?? 0), 0),
      service_tiers: serviceTiers.length,
      service_tier_context_tiers: serviceTiers.reduce(
        (n, tier) => n + (tier.contextTiers?.length ?? 0),
        0,
      ),
    });
    const caseModels = new Set(cases.map((c) => c.model));
    expect(rows.map(([key]) => key).filter((key) => !caseModels.has(key))).toEqual([]);
  });

  it("prices every case to the same f64 as the Rust mirror", () => {
    const drift = cases.flatMap((c) => {
      const { price, onItsSide } = frontendPrice(c);
      return price === c.cost && onItsSide
        ? []
        : [`${c.rule}: rust ${String(c.cost)}, frontend ${String(price)}${onItsSide ? "" : " (wrong side)"}`];
    });
    expect(drift).toEqual([]);
    // Unpriced and priced cases both exist, so neither rule is vacuous.
    expect(cases.some((c) => c.cost === null)).toBe(true);
    expect(cases.filter((c) => c.cost !== null).length).toBeGreaterThan(cases.length / 2);
  });
});
