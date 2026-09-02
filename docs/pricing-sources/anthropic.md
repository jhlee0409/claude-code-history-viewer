# Anthropic Pricing Verification

**Verification date:** 2026-09-02

## Sources

- https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-09-02, pricing table)
- https://platform.claude.com/docs/en/about-claude/model-deprecations (fetched 2026-09-02, deprecation status and dates)

## Verified prices

| Model ID | Input | Output | Cache Read | Cache Write 5m | Cache Write 1h | Long-context threshold & rates | Service tiers | Deprecation/Retirement | Source URL |
|---|---|---|---|---|---|---|---|---|---|
| claude-fable-5 | $10 | $50 | $1 | $12.50 | $20 | Standard pricing to 1M tokens | - | Active | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-fable-5-1 | $10 | $50 | $0.25 | $12.50 | $20 | Standard pricing to 1M tokens | - | Active | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-mythos-5 | $10 | $50 | $1 | $12.50 | $20 | Standard pricing to 1M tokens | - | Active | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-mythos-5-1 | $10 | $50 | $0.25 | $12.50 | $20 | Standard pricing to 1M tokens | - | Active | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-mythos-preview | $10 | $50 | $1 | $12.50 | $20 | Standard pricing to 1M tokens | - | Deprecated (migrate to claude-mythos-5) | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| claude-opus-5 | $5 | $25 | $0.50 | $6.25 | $10 | Standard pricing to 1M tokens | - | Active; retirement not before 2027-07-24 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-4-8 | $5 | $25 | $0.50 | $6.25 | $10 | Standard pricing to 1M tokens | - | Active; retirement not before 2027-05-28 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-4-7 | $5 | $25 | $0.50 | $6.25 | $10 | Standard pricing to 1M tokens | - | Active; retirement not before 2027-04-16 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-4-6 | $5 | $25 | $0.50 | $6.25 | $10 | Standard pricing to 1M tokens | - | Active; retirement not before 2027-02-05 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-4-5 | $5 | $25 | $0.50 | $6.25 | $10 | Standard pricing to 1M tokens | - | Active; retirement not before 2026-11-24 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-4-1 | $15 | $75 | $1.50 | $18.75 | $30 | - | - | Retired 2026-08-05 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-opus-4 | $15 | $75 | $1.50 | $18.75 | $30 | - | - | Retired 2026-06-15 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-sonnet-5 | $2 | $10 | $0.20 | $2.50 | $4 | Standard pricing to 1M tokens | - | Active; retirement not before 2027-06-30 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-sonnet-4-6 | $3 | $15 | $0.30 | $3.75 | $6 | Standard pricing to 1M tokens | - | Active; retirement not before 2027-02-17 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-sonnet-4-5 | $3 | $15 | $0.30 | $3.75 | $6 | Standard pricing to 1M tokens | - | Active; retirement not before 2026-09-29 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-sonnet-4 | $3 | $15 | $0.30 | $3.75 | $6 | - | - | Retired 2026-06-15 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-haiku-4-5 | $1 | $5 | $0.10 | $1.25 | $2 | Standard pricing to 1M tokens | - | Active; retirement not before 2026-10-15 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-3-5-sonnet | $3 | $15 | $0.30 | $3.75 | $6 | - | - | Retired 2025-10-28 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| claude-3-5-haiku | $0.80 | $4 | $0.08 | $1 | $1.60 | - | - | Retired 2026-02-19 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-haiku-3 | $0.25 | $1.25 | $0.03 | $0.30 | $0.50 | - | - | Retired 2026-04-20 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-3-haiku | $0.25 | $1.25 | $0.03 | $0.30 | $0.50 | - | - | Retired 2026-04-20 | https://platform.claude.com/docs/en/about-claude/pricing |

## Discrepancies vs current table

- **claude-fable-5**: OK — all prices match (10 input, 50 output, 1 cache read, 12.50 cache write 5m, 20 cache write 1h)
- **claude-mythos-5**: OK — all prices match (10 input, 50 output, 1 cache read, 12.50 cache write 5m, 20 cache write 1h)
- **claude-mythos-preview**: OK — prices match but model is deprecated (should migrate to claude-mythos-5)
- **claude-opus-5**: OK — all prices match (5 input, 25 output, 0.50 cache read, 6.25 cache write 5m, 10 cache write 1h)
- **claude-opus-4-8**: OK — all prices match (5 input, 25 output, 0.50 cache read, 6.25 cache write 5m, 10 cache write 1h)
- **claude-opus-4-7**: OK — all prices match (5 input, 25 output, 0.50 cache read, 6.25 cache write 5m, 10 cache write 1h)
- **claude-opus-4-6**: OK — all prices match (5 input, 25 output, 0.50 cache read, 6.25 cache write 5m, 10 cache write 1h)
- **claude-opus-4-5**: OK — all prices match (5 input, 25 output, 0.50 cache read, 6.25 cache write 5m, 10 cache write 1h)
- **claude-opus-4-1**: OK — all prices match (15 input, 75 output, 1.50 cache read, 18.75 cache write 5m, 30 cache write 1h); model retired 2026-08-05
- **claude-opus-4**: OK — all prices match (15 input, 75 output, 1.50 cache read, 18.75 cache write 5m, 30 cache write 1h); model retired 2026-06-15
- **claude-sonnet-5**: OK — all prices match (2 input, 10 output, 0.20 cache read, 2.50 cache write 5m, 4 cache write 1h); note: prices locked through 2026-08-31, previously scheduled to increase
- **claude-sonnet-4-6**: OK — all prices match (3 input, 15 output, 0.30 cache read, 3.75 cache write 5m, 6 cache write 1h)
- **claude-sonnet-4-5**: OK — all prices match (3 input, 15 output, 0.30 cache read, 3.75 cache write 5m, 6 cache write 1h)
- **claude-sonnet-4**: OK — all prices match (3 input, 15 output, 0.30 cache read, 3.75 cache write 5m, 6 cache write 1h); model retired 2026-06-15
- **claude-haiku-4-5**: OK — all prices match (1 input, 5 output, 0.10 cache read, 1.25 cache write 5m, 2 cache write 1h)
- **claude-3-5-sonnet**: OK — all prices match (3 input, 15 output, 0.30 cache read, 3.75 cache write 5m, 6 cache write 1h); model already retired 2025-10-28
- **claude-3-5-haiku**: OK — all prices match (0.80 input, 4 output, 0.08 cache read, 1 cache write 5m, 1.60 cache write 1h); model retired 2026-02-19 (official name: Claude Haiku 3.5)
- **claude-haiku-3**: OK — all prices match (0.25 input, 1.25 output, 0.03 cache read, 0.30 cache write 5m, 0.50 cache write 1h); model retired 2026-04-20
- **claude-3-haiku**: OK — all prices match (0.25 input, 1.25 output, 0.03 cache read, 0.30 cache write 5m, 0.50 cache write 1h); model already retired 2026-04-20
- **MISSING → added**: `claude-fable-5-1` and `claude-mythos-5-1` (10 / 50, cache read **0.25**, cache write 12.50 / 20). Without explicit keys they prefix-matched `claude-fable-5` / `claude-mythos-5` and cache reads were over-priced 4x.
- **MISSING → added**: `claude-3-7-sonnet` (3 / 15 / 0.30 / 3.75 / 6; retired 2026-02-19) at its last published rate so 2025 Claude Code sessions stay priced.
- **Fast mode** for `claude-opus-5` / `claude-opus-4-8` recorded as `serviceTiers.fast` = 10 / 50 with the published cache multipliers (12.50 / 20 / 1) stacked on top.
- Retirement dates from the deprecations page recorded as `deprecatedAt`: opus-4-1 2026-08-05, opus-4 2026-06-15, sonnet-4 2026-06-15, 3-5-sonnet 2025-10-28, 3-5-haiku 2026-02-19, haiku-3 / 3-haiku 2026-04-20. "Not sooner than" dates for active models are tentative and deliberately not recorded.

## Notes

### Prompt caching and cache pricing

- Anthropic publishes three cache operation rates:
  - **Cache write (5m)**: 1.25x base input price; cache valid for 5 minutes
  - **Cache write (1h)**: 2x base input price; cache valid for 1 hour
  - **Cache read (hit)**: 0.1x base input price for most models; 0.025x for Claude Fable 5.1 and Claude Mythos 5.1

- Cache hits pay off after one read for the 5m duration (1.25x write cost), or after two reads for the 1h duration (2x write cost).

### Claude Fable 5.1 and Claude Mythos 5.1 special pricing

- Both Claude Fable 5.1 and Claude Mythos 5.1 feature a reduced cache read multiplier of 0.025x base input price (vs 0.1x on all other models), published as \$0.25 per million tokens.
- These are \"limited availability\" models not currently in the main table but officially published.

### Long-context pricing

- **No long-context tier pricing:** Claude 4.6 and later models (including Claude Fable 5, Claude Mythos 5, and all current Opus/Sonnet/Haiku 4.x models) include the full 1M token context window at standard pricing. There is no rate increase at any context threshold.
- Batch API and prompt caching discounts apply at standard rates across the full context window.

### Retiring models still on table

The following models in the current pricing table have already been retired on the Claude API:
- **claude-opus-4-1**: Retired 2026-08-05 (now available only on Bedrock and Google Cloud)
- **claude-opus-4**: Retired 2026-06-15 (now available only on Google Cloud)
- **claude-sonnet-4**: Retired 2026-06-15 (now available only on Bedrock and Google Cloud)
- **claude-3-5-sonnet**: Retired 2025-10-28 (completely unavailable on Claude API)
- **claude-3-5-haiku**: Retired 2026-02-19 (now available only on Bedrock and Google Cloud)
- **claude-3-haiku**: Retired 2026-04-20 (completely unavailable on Claude API)

Partner-operated platforms (Bedrock, Google Cloud) may have independent retirement schedules. The prices are correct for when the models were active on Claude API.

### Pricing changes

- **Claude Sonnet 5 pricing**: The \$2/\$10 per million input/output token pricing, announced at launch as introductory pricing through 2026-08-31, is now the standard price. The previously scheduled increase to \$3/\$15 on 2026-09-01 will not occur.

### Tokenization change

- Claude 4.7 and later models use a newer tokenizer that produces approximately 30% more tokens for the same text than Claude Sonnet 4.6 and earlier models. Exact token count increase varies by workload.

### Feature-specific pricing

- **Fast mode** (research preview, Opus 5/4.8 only): \$10/\$50 per MTok (2x standard). Not in main table.
- **Batch API**: 50% discount on both input and output tokens (not in main pricing table structure, but disclosed as a separate feature).
- **Data residency** (Claude 4.6+ only): 1.1x multiplier on all token pricing for US-only inference via `inference_geo: \"us\"`.
- **Tool use**: Additional fixed token counts for system prompt per model; see pricing documentation for details.

### Cloud platform pricing

Anthropic offers Claude through partner platforms with independent pricing:
- **Amazon Bedrock**: Uses Claude Consumption Units (CCU); \$0.01 per CCU (token usage converted to CCU at same rates as Claude API).
- **Google Cloud Vertex AI**: Separate regional pricing; see Cloud documentation.
- **Microsoft Foundry**: Uses Claude Consumption Units; \$0.01 per CCU.
- **Claude Platform on AWS**: Same CCU billing as Bedrock; rates same as Claude API.

This document covers Claude API (first-party) pricing only.
