# xAI Pricing Verification – 2026-09-02

## Sources

- https://docs.x.ai/developers/models (fetched 2026-09-02; text API pricing table + alias rules)
- https://docs.x.ai/developers/models/grok-4.6 (fetched 2026-09-02)
- https://docs.x.ai/developers/models/grok-4.5 (fetched 2026-09-02; lists aliases `grok-4.5-latest`, `grok-build-latest`)
- https://docs.x.ai/developers/models/grok-4.3 (fetched 2026-09-02)
- https://docs.x.ai/developers/models/grok-code-fast-1 (fetched 2026-09-02; page title "Grok Build 0.1", lists aliases `grok-code-fast-1`, `grok-code-fast`, `grok-code-fast-1-0825`)
- https://docs.x.ai/developers/models/grok-4 — redirects to the models index; grok-4 is no longer documented.

## Verified prices

All rates USD per 1M tokens. xAI publishes no cache-write charge; cached prompt tokens are billed at the "cached input" rate. Long-context pricing applies to **every token in the request** once the prompt reaches 200k tokens (`minContextTokens: 200000`).

| model id | input | output | cache read | cache write 5m | cache write 1h | ≥200k prompt | service tiers | deprecation | source |
|---|---|---|---|---|---|---|---|---|---|
| grok-4.6 | 2.00 | 6.00 | 0.50 | - | - | 4.00 / 12.00 / 1.00 | - | none published | models/grok-4.6 |
| grok-4.5 | 2.00 | 6.00 | 0.30 | - | - | 4.00 / 12.00 / 0.60 | - | none published | models/grok-4.5 |
| grok-build-latest | alias of grok-4.5 | | | | | | | | models/grok-4.5 |
| grok-4.3 | 1.25 | 2.50 | 0.20 | - | - | 2.50 / 5.00 / 0.40 | - | none published | models/grok-4.3 |
| grok-4.20-0309-reasoning | 1.25 | 2.50 | 0.20 | - | - | 2.50 / 5.00 / 0.40 | - | none published | models index |
| grok-4.20-0309-non-reasoning | 1.25 | 2.50 | 0.20 | - | - | 2.50 / 5.00 / 0.40 | - | none published | models index |
| grok-4.20-multi-agent-0309 | 1.25 | 2.50 | 0.20 | - | - | 2.50 / 5.00 / 0.40 | - | none published | models index |
| grok-build-0.1 | 1.00 | 2.00 | 0.20 | - | - | 2.00 / 4.00 / 0.40 | - | none published | models/grok-code-fast-1 |
| grok-code-fast-1 / grok-code-fast / grok-code-fast-1-0825 | aliases of grok-build-0.1 | | | | | | | | models/grok-code-fast-1 |
| grok-4 | 3.00 | 15.00 | 0.75 | - | - | UNVERIFIED | - | no longer documented; LiteLLM records 2026-05-15 | last published rate |

## Discrepancies vs current table

- grok-4.6, grok-4.5, grok-build-latest, grok-4.3, grok-4.20-*: **OK** (rates match). Threshold corrected 200,001 → 200,000 because xAI bills the higher rate once the prompt *reaches* 200k.
- grok-build-0.1: **OK**.
- grok-code-fast-1, grok-code-fast, grok-code-fast-1-0825: **MISMATCH** — table had 1.25 / 2.50 / 0.20 (grok-4.3 rates). They are aliases of grok-build-0.1 → 1.00 / 2.00 / 0.20 (long: 2.00 / 4.00 / 0.40).
- grok-4.5-build: **NOT LISTED** anywhere on docs.x.ai → removed. `grok-4.5-build…` ids still resolve to grok-4.5 through prefix matching.
- grok-build: **NOT LISTED** → removed. Concrete ids (`grok-build-0.1`, `grok-build-latest`) are priced explicitly.
- grok-4: **NOT LISTED** (page redirects). Kept at its last published rate with `deprecatedAt: 2026-05-15` so historical sessions stay priced.

## Notes

- Aliases: `<model>` → latest stable, `<model>-latest` → latest version, `<model>-<date>` → pinned snapshot.
- No Batch API discount is modelled; only grok-4.3 documents one (20%).
- Imagine/voice models are per-image / per-second / per-character and are excluded from the token table.
