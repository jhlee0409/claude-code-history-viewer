# OpenAI Pricing Verification – 2026-09-02

## Sources

- https://developers.openai.com/api/docs/pricing (fetched 2026-09-02; Standard / Fast mode / Cyber tables)
- https://developers.openai.com/api/docs/models (fetched 2026-09-02; catalog)
- https://developers.openai.com/api/docs/deprecations (fetched 2026-09-02)
- Per-model pages (fetched 2026-09-02) for ids that are no longer on the pricing table:
  chat-latest, gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5-codex,
  codex-mini-latest, gpt-5.3-chat-latest, gpt-5.2-chat-latest, gpt-5.1-chat-latest, gpt-5-chat-latest, gpt-4,
  gpt-daybreak-blue-latest, gpt-daybreak-red-latest — `https://developers.openai.com/api/docs/models/<id>`

## Verified prices

USD per 1M tokens, Standard tier. "cached input" is the cache-read rate. Only the GPT-5.6 family publishes a cache-write charge. Long context = prompt ≥ 272k tokens (`minContextTokens: 272000`); the long rate applies to the whole request. Fast mode = `service_tier: fast` (or the legacy `priority`); cached-input discounts still apply.

| model id | input | cached | cache write | output | long (input / cached / write / output) | fast (input / cached / write / output) | deprecation | source |
|---|---|---|---|---|---|---|---|---|
| gpt-5.6-sol | 4.00 | 0.40 | 5.00 | 20.00 | 8 / 0.8 / 10 / 30 | 8 / 0.8 / 10 / 40 (long 16 / 1.6 / 20 / 60) | promo ≥ 2026-11-21 | pricing |
| gpt-5.6-terra | 2.00 | 0.20 | 2.50 | 12.00 | 4 / 0.4 / 5 / 18 | 4 / 0.4 / 5 / 24 (long 8 / 0.8 / 10 / 36) | - | pricing |
| gpt-5.6-luna | 0.20 | 0.02 | 0.25 | 1.20 | 0.4 / 0.04 / 0.5 / 1.8 | 0.4 / 0.04 / 0.5 / 2.4 (long 0.8 / 0.08 / 1 / 3.6) | - | pricing |
| gpt-5.6-cyber | 12.50 | 1.25 | 15.625 | 75.00 | - | - | - | pricing (Cyber) |
| gpt-5.5-cyber | 12.50 | 1.25 | - | 75.00 | - | - | - | pricing (Cyber) |
| gpt-daybreak-blue-latest | = gpt-5.6-sol | | | | | | alias | models/gpt-daybreak-blue-latest |
| gpt-daybreak-red-latest | = gpt-5.6-cyber | | | | | | alias | models/gpt-daybreak-red-latest |
| gpt-5.5 | 5.00 | 0.50 | - | 30.00 | 10 / 1 / - / 45 | 12.5 / 1.25 / - / 75 | - | pricing |
| gpt-5.4 | 2.50 | 0.25 | - | 15.00 | 5 / 0.5 / - / 22.5 | 5 / 0.5 / - / 30 | - | pricing |
| gpt-5.4-mini | 0.75 | 0.075 | - | 4.50 | - | 1.5 / 0.15 / - / 9 | - | pricing |
| gpt-5.4-nano | 0.20 | 0.02 | - | 1.25 | - | - | - | pricing |
| gpt-5.2 | 1.75 | 0.175 | - | 14.00 | - | 3.5 / 0.35 / - / 28 | - | pricing |
| gpt-5.1 | 1.25 | 0.125 | - | 10.00 | - | 2.5 / 0.25 / - / 20 | - | pricing |
| gpt-5 | 1.25 | 0.125 | - | 10.00 | - | 2.5 / 0.25 / - / 20 | - | pricing |
| gpt-5-mini | 0.25 | 0.025 | - | 2.00 | - | 0.45 / 0.045 / - / 3.6 | - | pricing |
| gpt-5-nano | 0.05 | 0.005 | - | 0.40 | - | - | - | pricing |
| gpt-4.1 | 2.00 | 0.50 | - | 8.00 | - | 3.5 / 0.875 / - / 14 | - | pricing |
| gpt-4.1-mini | 0.40 | 0.10 | - | 1.60 | - | 0.7 / 0.175 / - / 2.8 | - | pricing |
| gpt-4.1-nano | 0.10 | 0.025 | - | 0.40 | - | 0.2 / 0.05 / - / 0.8 | 2026-10-23 | pricing, deprecations |
| gpt-4o | 2.50 | 1.25 | - | 10.00 | - | 4.25 / 2.125 / - / 17 | - | pricing |
| gpt-4o-mini | 0.15 | 0.075 | - | 0.60 | - | 0.25 / 0.125 / - / 1 | - | pricing |
| gpt-4-turbo (2024-04-09) | 10.00 | - | - | 30.00 | - | - | 2026-10-23 | pricing, deprecations |
| gpt-4 (0613) | 30.00 | - | - | 60.00 | - | - | 2026-10-23 | pricing, deprecations |
| gpt-3.5-turbo | 0.50 | - | - | 1.50 | - | - | 2026-10-23 | pricing, deprecations |
| o3 | 2.00 | 0.50 | - | 8.00 | - | 3.5 / 0.875 / - / 14 | - | pricing |
| o3-mini | 1.10 | 0.55 | - | 4.40 | - | - | 2026-10-23 | pricing, deprecations |
| o4-mini | 1.10 | 0.275 | - | 4.40 | - | 2 / 0.5 / - / 8 | 2026-10-23 | pricing, deprecations |
| o1 | 15.00 | 7.50 | - | 60.00 | - | - | 2026-10-23 | pricing, deprecations |
| chat-latest | 5.00 | 0.50 | - | 30.00 | - | - | - | models/chat-latest |
| gpt-5.3-codex | 1.75 | 0.175 | - | 14.00 | - | 3.5 / 0.35 / - / 28 (not on Fast table; LiteLLM corroborates) | active | models/gpt-5.3-codex |
| gpt-5.3-codex-fast | Codex CLI id for gpt-5.3-codex Fast mode | | | | | | | see above |
| gpt-5.3-chat-latest | 1.75 | 0.175 | - | 14.00 | - | - | 2026-08-10 | models page, deprecations |
| gpt-5.2-chat-latest | 1.75 | 0.175 | - | 14.00 | - | - | 2026-08-10 | models page, deprecations |
| gpt-5.2-codex | 1.75 | 0.175 | - | 14.00 | - | - | 2026-07-23 | models page, deprecations |
| gpt-5.1-codex | 1.25 | 0.125 | - | 10.00 | - | - | 2026-07-23 | models page, deprecations |
| gpt-5.1-codex-max | 1.25 | 0.125 | - | 10.00 | - | - | 2026-07-23 | models page, deprecations |
| gpt-5.1-codex-mini | 0.25 | 0.025 | - | 2.00 | - | - | 2026-07-23 | models page, deprecations |
| gpt-5.1-chat-latest | 1.25 | 0.125 | - | 10.00 | - | - | 2026-07-23 | models page, deprecations |
| gpt-5-codex | 1.25 | 0.125 | - | 10.00 | - | - | 2026-07-23 | models page, deprecations |
| gpt-5-chat-latest | 1.25 | 0.125 | - | 10.00 | - | - | 2026-07-23 | models page, deprecations |
| codex-mini (codex-mini-latest) | 1.50 | 0.375 | - | 6.00 | - | - | 2026-02-12 | models page, deprecations |

Not modelled (no cached-input rate, not coding-agent models): gpt-5.5-pro, gpt-5.4-pro, gpt-5.2-pro, gpt-5-pro, o1-pro, o3-pro, gpt-4o-2024-05-13, gpt-4.5-*, base/instruct models, realtime/audio/image models.

## Discrepancies vs current table

- gpt-5.6-sol: **MISMATCH** — table had 5 / 30 / 0.5 / cw 6.25 (long 10 / 45 / 1 / 12.5). Official: 4 / 20 / 0.4 / cw 5 (long 8 / 30 / 0.8 / 10). Promotional through at least 2026-11-21.
- gpt-5.6 (bare key): **NOT LISTED** — no such model id; only sol/terra/luna/cyber exist. Removed so unknown `gpt-5.6-*` ids report "unavailable" instead of a guess.
- daybreak-blue-latest / daybreak-red-latest: **wrong key** — official aliases are `gpt-daybreak-blue-latest` / `gpt-daybreak-red-latest`; the old keys never matched. Renamed and re-pointed to sol / cyber rates.
- gpt-5.6-terra, gpt-5.6-luna, gpt-5.6-cyber, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-5-nano, gpt-4.1(-mini/-nano), gpt-4o(-mini), gpt-4, o4-mini, codex-mini, chat-latest, all codex/chat-latest variants: **OK** (rates match). Fast-mode tiers added where the Fast table publishes them; announced shutdown dates recorded as `deprecatedAt`.
- gpt-5.3-codex / gpt-5.3-codex-fast: **OK** for Standard; the Fast rate (3.5 / 28 / 0.35) is not on the official Fast table but is recorded by LiteLLM as the priority rate — kept, flagged in `note`.
- Long-context threshold corrected 272,001 → 272,000 (pricing page defines short context as "<272K").
- **MISSING → added**: gpt-5.5-cyber, gpt-5.2-chat-latest, gpt-5.1-codex-mini, gpt-4-turbo, gpt-3.5-turbo, o3, o3-mini, o1.

## Notes

- Cache writes are charged only for the GPT-5.6 family. Other models show "-" and are modelled as `cacheWrite: null`.
- Priority processing was renamed Fast mode on 2026-07-30; both `service_tier` values are accepted and `calculations.ts` normalises `priority` → `fast`.
- Data-residency endpoints add a 10% uplift for models released on/after 2026-03-05 — not modelled (no signal in session logs).
- Batch and Flex tiers are 50% of Standard — not modelled (not used by coding agents).
- Retired models keep their last published rate so historical sessions remain priced; `deprecatedAt` marks the shutdown date.

## 2026-10-01 update (pricing watch #596)

Targeted check against https://developers.openai.com/api/docs/pricing and the model pages — not a full re-audit.

- **`gpt-5.6-sol`: unchanged.** Pricing page ("Cyber models"): `| gpt-5.6-sol | $4.00 | $0.40 | $5.00 | $20.00 | $8.00 | $0.80 | $10.00 | $30.00` and "GPT-5.6 Sol's promotional pricing is available at least through November 21, 2026." The feed's $2/$10 is the Batch row. Fast tier 8 / 0.8 / 10 / 40 re-confirmed; the fast long-context tier was not re-read, so `verifiedAt` stays 2026-09-02.
- **Added `gpt-6-sol`**: 2 / 0.2 / 2.5 / 10, fast 4 / 0.4 / 5 / 20. Long-context and fast long-context rates are derived from the model page ("Prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output"; "Fast mode is priced at 2x the applicable rates"); they are not on the pricing table.
- **Added `gpt-6.1-sol`**: `$2.00 / $0.10 / $2.50 / $10.00 / long $4.00 / $0.20 / $5.00 / $15.00`; fast `$4.00 / $0.20 / $5.00 / $20.00 / long $8.00 / $0.40 / $10.00 / $30.00`.
- **Added `gpt-6-luna`**: `$0.10 / $0.01 / $0.125 / $0.50 / long $0.20 / $0.02 / $0.25 / $0.75`; fast `$0.20 / $0.02 / $0.25 / $1.00 / long $0.40 / $0.04 / $0.50 / $1.50`.
- **Added `gpt-6-astra`**: `$10 / $1 / $12.50 / $50 / long $20 / $2 / $25 / $75`; fast `$20 / $2 / $25 / $100 / long $40 / $4 / $50 / $150`. The Ultrafast row (`$60 / $6 / $75 / $300`) is not stored: `calculations.ts` only maps `priority` → `fast`.
- **Not added: `gpt-6-*-pro`.** The model pages return 404, they are not on the pricing page, and the deprecations page treats "pro" as a reasoning mode (`gpt-5.6-sol (reasoning.mode: pro)`), not a model id.
- `gpt-5-codex` ($1.25 / $0.125 / $10), `gpt-5.3-codex` ($1.75 / $0.175 / $14), `codex-mini-latest` ($1.50 / $0.375 / $6) and the `gpt-daybreak-*` aliases re-confirmed.
- For a later audit: dated snapshots `gpt-5-2025-08-07`, `gpt-5-mini-2025-08-07`, `gpt-5-nano-2025-08-07`, `o3-2025-04-16` and others retire on 2026-12-11; the table only has the undated aliases, which are not announced as retiring.
