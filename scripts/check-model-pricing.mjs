#!/usr/bin/env node
/**
 * Compare src/data/model-pricing.json against public, machine-readable price
 * feeds and print a markdown report of anything that drifted.
 *
 * Sources (corroboration only — the official provider pages remain the source
 * of truth; see docs/pricing-sources/):
 *   - LiteLLM model_prices_and_context_window.json (per-token USD)
 *   - OpenRouter /api/v1/models (per-token USD, plus `created` timestamps that
 *     surface newly listed models)
 *
 * Usage:
 *   node scripts/check-model-pricing.mjs            # report to stdout
 *   node scripts/check-model-pricing.mjs --out report.md
 *   node scripts/check-model-pricing.mjs --fail-on-diff
 *
 * The script never edits the pricing file. Findings are for a human to verify
 * against the provider's page before touching user-facing cost numbers.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRICING_PATH = path.join(ROOT, "src/data/model-pricing.json");
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

/** Our provider ids → ids used by each feed. */
const PROVIDER_ALIASES = {
  anthropic: { litellm: ["anthropic"], openrouter: ["anthropic"] },
  openai: { litellm: ["openai"], openrouter: ["openai"] },
  google: { litellm: ["gemini"], openrouter: ["google"] },
  xai: { litellm: ["xai"], openrouter: ["x-ai"] },
  minimax: { litellm: ["minimax"], openrouter: ["minimax"] },
};

const NEW_MODEL_WINDOW_DAYS = 45;
// Feeds round to a few decimals; flag only differences a human should look at.
const RATE_TOLERANCE_ABS = 0.006; // USD per 1M tokens
const RATE_TOLERANCE_REL = 0.05;
const DEPRECATION_HORIZON_DAYS = 90;

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
const failOnDiff = args.includes("--fail-on-diff");

/** `claude-sonnet-4-5` and `claude-sonnet-4.5` must compare equal. */
const canonical = (id) =>
  id
    .toLowerCase()
    .split("/")
    .at(-1)
    .replace(/(\d)-(\d)/g, "$1.$2");

const perMillion = (perToken) =>
  perToken == null || perToken === "" ? null : Number(perToken) * 1_000_000;

const fmt = (value) => (value == null ? "-" : `$${Number(value.toFixed(6))}`);

const differs = (ours, theirs) => {
  // `null` on either side means "not published" — nothing to compare. Google,
  // for instance, bills cache storage per hour, which OpenRouter folds into a
  // per-token cache-write figure we deliberately do not model.
  if (ours == null || theirs == null) return false;
  return Math.abs(ours - theirs) > Math.max(RATE_TOLERANCE_ABS, ours * RATE_TOLERANCE_REL);
};

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "claude-code-history-viewer pricing-watch" } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

function indexLiteLLM(feed) {
  const byProvider = new Map();
  for (const [id, entry] of Object.entries(feed)) {
    if (!entry || typeof entry !== "object" || entry.mode !== "chat") continue;
    const provider = entry.litellm_provider;
    if (!byProvider.has(provider)) byProvider.set(provider, new Map());
    // Keep the first (usually undated) id when several ids collapse to one canonical name.
    const key = canonical(id);
    if (!byProvider.get(provider).has(key)) byProvider.get(provider).set(key, { id, entry });
  }
  return byProvider;
}

function indexOpenRouter(feed) {
  const byProvider = new Map();
  for (const model of feed.data ?? []) {
    const provider = model.id.split("/")[0];
    if (!byProvider.has(provider)) byProvider.set(provider, new Map());
    byProvider.get(provider).set(canonical(model.id), model);
  }
  return byProvider;
}

function lookup(index, providerIds, key) {
  for (const providerId of providerIds) {
    const hit = index.get(providerId)?.get(key);
    if (hit) return hit;
  }
  return null;
}

function compareLiteLLM(key, ours, hit) {
  const theirs = hit.entry;
  const rows = [];
  const pairs = [
    ["input", ours.input, perMillion(theirs.input_cost_per_token)],
    ["output", ours.output, perMillion(theirs.output_cost_per_token)],
    ["cacheRead", ours.cacheRead, perMillion(theirs.cache_read_input_token_cost)],
    ["cacheWrite", ours.cacheWrite, perMillion(theirs.cache_creation_input_token_cost)],
    ["cacheWriteOneHour", ours.cacheWriteOneHour, perMillion(theirs.cache_creation_input_token_cost_above_1hr)],
  ];
  for (const [field, mine, feed] of pairs) {
    if (differs(mine, feed)) rows.push({ key, field, ours: mine, theirs: feed, source: `litellm:${hit.id}` });
  }
  const longInput = perMillion(theirs.input_cost_per_token_above_200k_tokens);
  // xAI bills long context from 200,000 tokens, Google from 200,001.
  const longTier = ours.contextTiers?.find((tier) => tier.minContextTokens >= 200_000 && tier.minContextTokens <= 200_001);
  if (longInput != null && !longTier) {
    rows.push({ key, field: "contextTiers(>200K)", ours: null, theirs: longInput, source: `litellm:${hit.id}` });
  } else if (longTier && differs(longTier.input, longInput)) {
    rows.push({ key, field: "contextTiers(>200K).input", ours: longTier.input, theirs: longInput, source: `litellm:${hit.id}` });
  }
  return rows;
}

function compareOpenRouter(key, ours, model) {
  const pricing = model.pricing ?? {};
  const rows = [];
  const pairs = [
    ["input", ours.input, perMillion(pricing.prompt)],
    ["output", ours.output, perMillion(pricing.completion)],
    ["cacheRead", ours.cacheRead, perMillion(pricing.input_cache_read)],
    ["cacheWrite", ours.cacheWrite, perMillion(pricing.input_cache_write)],
    ["cacheWriteOneHour", ours.cacheWriteOneHour, perMillion(pricing.input_cache_write_1h)],
  ];
  for (const [field, mine, feed] of pairs) {
    if (differs(mine, feed)) rows.push({ key, field, ours: mine, theirs: feed, source: `openrouter:${model.id}` });
  }
  return rows;
}

function main(pricing, litellmIndex, openrouterIndex) {
  const mismatches = [];
  const unmatched = [];
  const deprecations = [];
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + DEPRECATION_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);

  for (const [key, ours] of Object.entries(pricing.models)) {
    const aliases = PROVIDER_ALIASES[ours.provider];
    if (!aliases) throw new Error(`Unknown provider '${ours.provider}' for ${key}`);
    const canonicalKey = canonical(key);
    const litellm = lookup(litellmIndex, aliases.litellm, canonicalKey);
    const openrouter = lookup(openrouterIndex, aliases.openrouter, canonicalKey);
    if (!litellm && !openrouter) unmatched.push(key);

    // A retired model's last published rate cannot change; feeds that still
    // list it drift on their own and would only add noise.
    if (ours.deprecatedAt && ours.deprecatedAt <= today) continue;

    if (litellm) mismatches.push(...compareLiteLLM(key, ours, litellm));
    if (openrouter) mismatches.push(...compareOpenRouter(key, ours, openrouter));

    // LiteLLM also records "not sooner than" tentative dates; only a date we
    // do not have that falls inside the horizon needs a look.
    const feedDeprecation = litellm?.entry.deprecation_date;
    if (feedDeprecation && !ours.deprecatedAt && feedDeprecation <= horizon) {
      deprecations.push({ key, ours: null, theirs: feedDeprecation, source: `litellm:${litellm.id}` });
    }
  }

  // Newly listed models on OpenRouter that none of our keys cover (prefix match
  // mirrors `matchesModelKey` in calculations.ts).
  const ourKeys = Object.keys(pricing.models).map(canonical);
  const covered = (id) => ourKeys.some((k) => id === k || id.startsWith(`${k}-`) || id.startsWith(`${k}@`) || id.startsWith(`${k}:`));
  const cutoff = Date.now() / 1000 - NEW_MODEL_WINDOW_DAYS * 86_400;
  const newModels = [];
  for (const [provider, aliases] of Object.entries(PROVIDER_ALIASES)) {
    for (const providerId of aliases.openrouter) {
      for (const [canonicalId, model] of openrouterIndex.get(providerId) ?? []) {
        if (model.created >= cutoff && !covered(canonicalId)) {
          newModels.push({ provider, id: model.id, created: new Date(model.created * 1000).toISOString().slice(0, 10), input: perMillion(model.pricing?.prompt), output: perMillion(model.pricing?.completion) });
        }
      }
    }
  }

  return { mismatches, unmatched, deprecations, newModels };
}

function render(pricing, result) {
  const { mismatches, unmatched, deprecations, newModels } = result;
  const lines = [];
  lines.push(`# Model pricing watch`, ``);
  lines.push(`Table audited **${pricing.auditedAt}** · ${Object.keys(pricing.models).length} entries · checked ${new Date().toISOString().slice(0, 10)}`, ``);
  lines.push(`Feeds are corroboration only. Confirm every change on the provider's official page (links in \`docs/pricing-sources/\`) before editing \`src/data/model-pricing.json\`.`, ``);

  lines.push(`## Rate mismatches (${mismatches.length})`, ``);
  if (mismatches.length) {
    lines.push(`| model | field | ours | feed | feed id |`, `|---|---|---|---|---|`);
    for (const m of mismatches) lines.push(`| ${m.key} | ${m.field} | ${fmt(m.ours)} | ${fmt(m.theirs)} | ${m.source} |`);
  } else lines.push(`None.`);
  lines.push(``);

  lines.push(`## Deprecation signals (${deprecations.length})`, ``);
  if (deprecations.length) {
    lines.push(`| model | ours | feed | feed id |`, `|---|---|---|---|`);
    for (const d of deprecations) lines.push(`| ${d.key} | ${d.ours ?? "-"} | ${d.theirs} | ${d.source} |`);
  } else lines.push(`None.`);
  lines.push(``);

  lines.push(`## Newly listed models not covered (last ${NEW_MODEL_WINDOW_DAYS} days, ${newModels.length})`, ``);
  if (newModels.length) {
    lines.push(`| provider | model | listed | input | output |`, `|---|---|---|---|---|`);
    for (const n of newModels) lines.push(`| ${n.provider} | ${n.id} | ${n.created} | ${fmt(n.input)} | ${fmt(n.output)} |`);
  } else lines.push(`None.`);
  lines.push(``);

  lines.push(`## Entries absent from both feeds (${unmatched.length})`, ``);
  lines.push(unmatched.length ? unmatched.map((k) => `- ${k}`).join("\n") : `None.`);
  lines.push(``);
  return lines.join("\n");
}

const pricing = JSON.parse(await readFile(PRICING_PATH, "utf8"));
const [litellmFeed, openrouterFeed] = await Promise.all([fetchJson(LITELLM_URL), fetchJson(OPENROUTER_URL)]);
const result = main(pricing, indexLiteLLM(litellmFeed), indexOpenRouter(openrouterFeed));
const report = render(pricing, result);

if (outPath) await writeFile(outPath, report);
else process.stdout.write(report);

const findings = result.mismatches.length + result.deprecations.length + result.newModels.length;
if (outPath) console.log(`findings=${findings}`);
if (failOnDiff && findings > 0) process.exit(1);
