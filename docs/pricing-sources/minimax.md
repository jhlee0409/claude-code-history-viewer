# MiniMax Pricing Verification – 2026-09-02

## Sources

- https://platform.minimax.io/docs/guides/pricing-paygo (fetched 2026-09-02)
- https://platform.minimax.io/docs/guides/text-generation (fetched 2026-09-02)
- https://platform.minimax.io/docs/release-notes/models (fetched 2026-09-02)

## Verified prices

### MiniMax-M3

| Model | Input | Output | Cache Read | Cache Write 5m | Cache Write 1h | Long-Context Threshold & Rates | Service Tiers | Deprecation/Retirement | Source |
|-------|-------|--------|------------|----------------|----------------|------|----------|--------|----------|
| MiniMax-M3 (≤512K context) | \$0.30/M* | \$1.20/M* | \$0.06/M* | - | - | >512K context: input \$0.60/M, output \$2.40/M, cache read \$0.12/M | Priority: 1.5x standard (\$0.45/\$1.80/\$0.09) | None published | https://platform.minimax.io/docs/guides/pricing-paygo |
| MiniMax-M3 (>512K context) | \$0.60/M* | \$2.40/M* | \$0.12/M* | - | - | - | Priority: 1.5x standard (\$0.90/\$3.60/\$0.18) | None published | https://platform.minimax.io/docs/guides/pricing-paygo |

*Note: Permanent 50% discount applied; strikethrough prices shown on official docs as \$0.60→\$0.30, \$2.40→\$1.20, \$0.12→\$0.06 for ≤512K; \$1.20→\$0.60, \$4.80→\$2.40, \$0.24→\$0.12 for >512K

### MiniMax-M2.7

| Model | Input | Output | Cache Read | Cache Write 5m | Cache Write 1h | Long-Context Threshold & Rates | Service Tiers | Deprecation/Retirement | Source |
|-------|-------|--------|------------|----------------|----------------|------|----------|--------|----------|
| MiniMax-M2.7 | \$0.3/M | \$1.2/M | \$0.06/M | \$0.375/M | - | - | - | Legacy model, available to existing subscribers only | https://platform.minimax.io/docs/guides/pricing-paygo |

### MiniMax-M2.5

| Model | Input | Output | Cache Read | Cache Write 5m | Cache Write 1h | Long-Context Threshold & Rates | Service Tiers | Deprecation/Retirement | Source |
|-------|-------|--------|------------|----------------|----------------|------|----------|--------|----------|
| MiniMax-M2.5 | \$0.3/M | \$1.2/M | \$0.03/M | \$0.375/M | - | - | - | Legacy model, available to existing subscribers only; no explicit end-of-life date published | https://platform.minimax.io/docs/guides/pricing-paygo |

### MiniMax-M2.1

| Model | Input | Output | Cache Read | Cache Write 5m | Cache Write 1h | Long-Context Threshold & Rates | Service Tiers | Deprecation/Retirement | Source |
|-------|-------|--------|------------|----------------|----------------|------|----------|--------|----------|
| MiniMax-M2.1 | \$0.3/M | \$1.2/M | \$0.03/M | \$0.375/M | - | - | - | Legacy model, available to existing subscribers only; no explicit end-of-life date published | https://platform.minimax.io/docs/guides/pricing-paygo |

## Discrepancies vs current table

### minimax-m3
- **MISMATCH (prices shown as list rates, not effective discounted rates)**
  - Current table: input 0.6, output 2.4, cacheRead 0.12 for ≤512K; input 1.2, output 4.8, cacheRead 0.24 for >512K
  - Verified (with permanent 50% discount applied): input 0.3, output 1.2, cacheRead 0.06 for ≤512K; input 0.6, output 2.4, cacheRead 0.12 for >512K
  - **Source:** https://platform.minimax.io/docs/guides/pricing-paygo — official docs show both list prices (strikethrough) and current effective prices; current table appears to record pre-discount list prices
  - **Note:** MiniMax explicitly marks the 50% discount as "Permanent 50% off", and the effective prices are the ones currently charged; pricing page does not publish separate cache write rates for M3

### minimax-m2.7
- **OK**
  - Current: input 0.3, output 1.2, cacheRead 0.06, cacheWrite 0.375
  - Verified: input 0.3, output 1.2, cacheRead 0.06, cacheWrite 0.375
  - Source: https://platform.minimax.io/docs/guides/pricing-paygo

### minimax-m2.5
- **MISMATCH (cache read rate)**
  - Current table: cacheRead 0.06
  - Verified: cacheRead 0.03
  - Source: https://platform.minimax.io/docs/guides/pricing-paygo — M2.5 is listed under "Legacy Models" section with cache read rate \$0.03/M
  - **Note:** M2.5 is now only available to existing subscribers

### minimax-m2.1
- **MISMATCH (cache read rate)**
  - Current table: cacheRead 0.06
  - Verified: cacheRead 0.03
  - Source: https://platform.minimax.io/docs/guides/pricing-paygo — M2.1 is listed under "Legacy Models" section with cache read rate \$0.03/M
  - **Note:** M2.1 is now only available to existing subscribers


### Added after verification
- `minimax-m2.7-highspeed`, `minimax-m2.5-highspeed`, `minimax-m2.1-highspeed` (0.6 / 2.4, cache as base model) and `minimax-m2` (0.3 / 1.2 / 0.03 / 0.375). Without explicit keys the `-highspeed` ids prefix-matched the base model and were under-priced by half.
- `minimax-m3` Priority tier recorded as `serviceTiers.fast` (1.5x: 0.45 / 1.80 / 0.09; >512k 0.90 / 3.60 / 0.18). `calculations.ts` maps `service_tier: priority` to `fast`.

## Notes

1. **M3 Pricing Philosophy:** MiniMax publishes both list prices and effective prices with the "Permanent 50% off" discount applied. The current table records list prices; the effective prices users actually pay are 50% of those amounts.

2. **Cache Write Rates:** M3 does not publish separate cache write rates on the official pricing page (shown as `-` in tables). The pricing documentation only specifies input, output, and cache read for M3.

3. **Service Tiers:** M3 supports a "Priority" tier (set via `service_tier: priority`), which charges 1.5x the standard rate. This is not represented in the current MODEL_PRICING structure but is available as a billing option.

4. **Legacy Models:** M2.5 and M2.1 are explicitly marked as "Legacy Models" in the official pricing page and are documented as "only available to existing subscribers." No explicit end-of-life or sunset date is published.

5. **Long-Context:** The M3 tier boundary is 512K input tokens (≤512k vs >512k), not 512,001 as currently coded in contextTiers minContextTokens. The official docs use "512k" as the threshold, which typically means "512,000" but MiniMax's implementation detail on the exact boundary (512k or 512,001) was not explicitly confirmed in the pricing documentation.

6. **Token Counting:** Official docs state: "the token-to-character ratio varies slightly depending on the usage scenario, subject to actual consumption" and "Token to English word ratio (estimate): approximately 750 English words consume 1000 tokens".
