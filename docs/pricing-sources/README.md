# Model pricing sources

`src/data/model-pricing.json` is the only pricing table the app uses (USD per 1M tokens). Every entry names the official page it was read from (`source`) and the date it was confirmed (`verifiedAt`); `auditedAt` at the top is the last full audit. The per-provider files here are the audit notes for that date: which pages were read, what each model costs, what disagreed with the table, and billing rules that affect the calculation.

| provider | notes | official page |
|---|---|---|
| Anthropic | [anthropic.md](anthropic.md) | https://platform.claude.com/docs/en/about-claude/pricing |
| OpenAI | [openai.md](openai.md) | https://developers.openai.com/api/docs/pricing |
| Google Gemini | [google.md](google.md) | https://ai.google.dev/gemini-api/docs/pricing |
| xAI | [xai.md](xai.md) | https://docs.x.ai/developers/models |
| MiniMax | [minimax.md](minimax.md) | https://platform.minimax.io/docs/guides/pricing-paygo |

## How updates happen

1. **Weekly watch.** `.github/workflows/pricing-watch.yml` runs `node scripts/check-model-pricing.mjs`, which compares the table with the LiteLLM and OpenRouter price feeds and upserts the "📊 Model pricing watch" issue when rates drift, a shutdown date is near, or a provider lists a model we do not price. Run it locally the same way; `--fail-on-diff` makes it exit 1.
2. **Verify on the official page.** The feeds are corroboration only — they round, apply their own discounts (OpenRouter), or lag (LiteLLM still lists a Claude Sonnet 4.5 long-context tier the official page does not have). Open the provider page linked above and read the number there.
3. **Edit the JSON by hand** in a reviewed PR: update the rate, set `verifiedAt` to today, keep `source` pointing at the page you read, and add a `note` when the value needs context (promotional price, alias, rate not on the main table). Bump `auditedAt` only after re-checking every entry.
4. **Append to the provider file** what changed and why, so the next audit can see the history.

## Rules the table follows

- Only official first-party API prices. Subscription products and proxies (Cursor, Copilot, OpenCode, …) are never estimated; see `SOURCE_COST_ONLY_PROVIDER_IDS` in `calculations.ts`.
- A retired model keeps its last published rate with `deprecatedAt` set, so historical sessions stay priced. Unknown ids resolve to "unavailable" — never a default price.
- `cacheWrite: null` means the provider publishes no per-token cache-write charge (Google bills cache storage per hour; xAI and most OpenAI models publish none).
- `contextTiers[].minContextTokens` is the first token count billed at the long rate, using the provider's own definition: xAI and OpenAI "reach" the threshold (200000 / 272000); Google and MiniMax bill above it (200001 / 512001).
- `serviceTiers.fast` holds fast/priority rates; `calculations.ts` maps a reported `service_tier` of `priority` to `fast`.
- `deprecatedAt` is a provider-announced shutdown date (past or future); `replacedBy` is the replacement the same announcement recommends. `getModelLifecycle()` turns these into `retired` / `retiring` (within 90 days) / `active`, shown as a badge next to model ids in message details and the Global Overview, and as a warning in Settings Manager when `settings.model` names a retiring model. Anthropic's "not sooner than" dates are tentative and are **not** recorded — only confirmed retirements go in.
- Keys are lowercase model ids and match by exact id or `<key>-…` / `<key>@…` / `<key>:…` prefix, longest key first. Add an explicit key whenever a longer id has a different price than the prefix it would otherwise match (e.g. `claude-fable-5-1`, `minimax-m2.7-highspeed`).
