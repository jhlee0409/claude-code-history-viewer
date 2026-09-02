# Google Gemini API Pricing Verification

**Verified on:** 2026-09-02

## Sources

- https://ai.google.dev/gemini-api/docs/pricing (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/deprecations (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro (accessed 2026-09-02)
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash (accessed 2026-09-02)

## Verified prices

| Model ID | Input (USD/1M) | Output (USD/1M) | Cache Read (USD/1M) | Cache Write 5m (USD/1M) | Cache Write 1h (USD/1M) | Long-context threshold & rates | Service tiers | Deprecation/retirement date | Source URL |
|---|---|---|---|---|---|---|---|---|---|
| gemini-3.7-flash | 0.75 | 3.75 | 0.075 | - | - | None | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-3.6-flash | 0.75 | 3.75 | 0.075 | - | - | None | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-3.5-flash | 1.50 | 9.00 | 0.15 | - | - | None | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-3.5-flash-lite | 0.30 | 2.50 | 0.03 | - | - | None | Standard | No shutdown announced | https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite |
| gemini-3.1-pro-preview | 2.00 | 12.00 | 0.20 | - | - | >200K tokens: 4.00 input, 18.00 output | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-3-flash-preview | 0.50 | 3.00 | 0.05 | - | - | None | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-3.1-flash-lite | 0.25 | 1.50 | 0.025 | - | - | None | Standard | 2027-05-07 | https://ai.google.dev/gemini-api/docs/deprecations |
| gemini-2.5-pro | 1.25 | 10.00 | 0.125 | - | - | >200K tokens: 2.50 input, 15.00 output | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-2.5-flash | 0.30 | 2.50 | 0.03 | - | - | None | Standard, Batch, Flex, Priority | No shutdown announced | https://ai.google.dev/gemini-api/docs/pricing |
| gemini-2.5-flash-lite | 0.10 | 0.40 | 0.01 | - | - | None | Standard | No shutdown announced | https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite |

## Discrepancies vs current table

### gemini-3.7-flash
- **Status:** OK
- **Current:** 0.75 input, 3.75 output, 0.075 cache read
- **Verified:** 0.75 input, 3.75 output, 0.075 cache read
- **Notes:** Prices valid through 2026-12-31 (promotional rates); increase to 1.50 input, 7.50 output, 0.15 cache read starting 2027-01-01

### gemini-3.6-flash
- **Status:** OK
- **Current:** 0.75 input, 3.75 output, 0.075 cache read
- **Verified:** 0.75 input, 3.75 output, 0.075 cache read
- **Notes:** Prices valid through 2026-12-31 (promotional rates); increase to 1.50 input, 7.50 output, 0.15 cache read starting 2027-01-01

### gemini-3.5-flash
- **Status:** OK
- **Current:** 1.50 input, 9.00 output, 0.15 cache read
- **Verified:** 1.50 input, 9.00 output, 0.15 cache read

### gemini-3.5-flash-lite
- **Status:** OK
- **Current:** 0.30 input, 2.50 output, 0.03 cache read
- **Verified:** 0.30 input, 2.50 output, 0.03 cache read

### gemini-3.1-pro-preview
- **Status:** OK
- **Current:** 2.00 input, 12.00 output, 0.20 cache read; >200K: 4.00 input, 18.00 output
- **Verified:** 2.00 input, 12.00 output, 0.20 cache read; >200K: 4.00 input, 18.00 output

### gemini-3-flash-preview
- **Status:** OK
- **Current:** 0.50 input, 3.00 output, 0.05 cache read
- **Verified:** 0.50 input, 3.00 output, 0.05 cache read
- **Notes:** Status is "Preview" with no shutdown date announced; recommended migration to gemini-3.6-flash

### gemini-3.1-flash-lite
- **Status:** OK (pricing verified; deprecation updated)
- **Current:** 0.25 input, 1.50 output, 0.025 cache read
- **Verified:** 0.25 input, 1.50 output, 0.025 cache read
- **Notes:** Scheduled shutdown: 2027-05-07; recommended replacement is gemini-3.5-flash-lite

### gemini-2.5-pro
- **Status:** OK
- **Current:** 1.25 input, 10.00 output, 0.125 cache read; >200K: 2.50 input, 15.00 output
- **Verified:** 1.25 input, 10.00 output, 0.125 cache read; >200K: 2.50 input, 15.00 output
- **Notes:** Included thinking tokens at no extra cost; asynchronous batch processing available at 50% discount

### gemini-2.5-flash
- **Status:** OK
- **Current:** 0.30 input, 2.50 output, 0.03 cache read
- **Verified:** 0.30 input, 2.50 output, 0.03 cache read
- **Notes:** Output price includes thinking tokens; batch and flex inference modes available

### gemini-2.5-flash-lite
- **Status:** OK
- **Current:** 0.10 input, 0.40 output, 0.01 cache read
- **Verified:** 0.10 input, 0.40 output, 0.01 cache read
- **Notes:** Most cost-efficient multimodal model in the 2.5 family

## Notes

### Promotional pricing and expiry
- **Gemini 3.7 Flash and 3.6 Flash:** Current promotional paid-tier rates ($0.75 input, $3.75 output, $0.075 cache read) are **valid through 2026-12-31**. Starting 2027-01-01, rates will increase to $1.50 input, $7.50 output, and $0.15 cache read. This matches the comment in the current table stating "promotional paid-tier rates are valid through 2026-12-31".

### Cache pricing structure
- Google Gemini models publish cache read pricing but do not separately bill cache write (storage) operations. Instead, they charge a separate hourly storage rate for cached tokens ($0.50–$1.00 per 1M tokens per hour depending on model tier and promotion status).
- Our current table structure uses `cacheWrite` fields which are not applicable to Google's Gemini models; Google only specifies `cacheRead` and storage fees.

### Output tokens and thinking
- All Gemini models with thinking capability (2.5 Pro, 2.5 Flash, 3.1 Pro Preview, 3-Flash Preview) include thinking tokens in the output price—there is no separate billing for reasoning/thinking tokens vs. regular output tokens.

### Tiered pricing (long-context)
- **Gemini 3.1 Pro Preview and Gemini 2.5 Pro** both use context-length-based tiering:
  - Prompts ≤200K tokens use the base rate
  - Prompts >200K tokens trigger the higher tier for **the entire request** (not just tokens above the threshold)

### Model deprecation and recommended migrations
- **gemini-3.1-flash-lite:** Scheduled for shutdown on 2027-05-07. Recommended replacement is `gemini-3.5-flash-lite` (higher performance) or continue using the stable version.
- **gemini-3-flash-preview:** No shutdown date announced, but Google recommends migrating to `gemini-3.6-flash` for general availability and stability.
- **Gemini 2.0 models:** Already deprecated and shut down as of 2026-06-01.

### Service tiers
- Gemini 3.7 Flash, 3.6 Flash, and 3.5 Flash support additional service tiers: **Batch** (50% discount), **Flex**, and **Priority** (higher rates for faster processing).
- Gemini 3.5 Flash-Lite and 3.1 Flash-Lite support Standard tier only.
- All 2.5 models support Standard, Batch, Flex, and Priority tiers.
