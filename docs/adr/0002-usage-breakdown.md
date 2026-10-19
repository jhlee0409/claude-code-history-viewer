# 0002 — Usage breakdown: priced buckets over frontend-supplied local-day intervals

- **Status**: accepted
- **Date**: 2026-10-19
- **Plan reference**: inner-UI plan v3, ADR ④ (§4.7 usage-breakdown contract, §4.8 local-day
  intervals; review items R2, R3, C2). AN0a fixes the contract; AN0b implements it.

## Context

The 4B analytics overview must answer "what changed the estimated cost in this period, which
sessions carry it, and what data is missing" with exact sums **per local calendar day**. The
existing stats commands cannot be reused for that:

- **Local days are not UTC days or UTC hours.** Asia/Kolkata (UTC+5:30) midnight is 18:30Z and
  Asia/Kathmandu (UTC+5:45) midnight is 18:15Z, so 18:20Z and 18:40Z fall on different Kolkata
  days but in the same UTC hour (R2, reproduced with Python `zoneinfo`). DST days last 23, 23.5,
  24.5 or 25 hours, and Pacific/Apia skipped 2011-12-30 entirely. The existing cache
  (`stats/cache.rs`) composes **UTC-day** buckets and falls back to a full scan for any
  partially covered day, so every non-UTC local day is a cache miss.
- **Mixed source cost is lost.** For one model group the backend sums tokens over every row but
  `cost_usd` only over the rows that carry a provider-reported cost (`stats.rs` model
  aggregation), and the frontend prices the whole group with that `cost_usd` when it is present
  (`calculateGlobalCostSummary`). Measured with the real function: Sonnet, same tier, 1M input on
  each of two days, a provider cost of $1 on day A only → per-day sums 1 + 3 = **$4**, merged
  group **$1** (`scratch/inner-ui/probe/c2.probe.test.ts`). The merged figure silently drops the
  estimated part.
- **The old date filter is inclusive** (`is_within_date_limits`: `ts <= end`), so adjacent ranges
  double-count a row exactly at the shared edge.
- **Undated rows are stamped with `Utc::now()`** by the message pipeline
  (`ClaudeMessage::try_from`, noted in `stats/cache.rs`), so they land on "today".
- Pricing lives only in the frontend (`src/data/model-pricing.json`); Rust has no price table.

## Decision

### 1. One new read-only command, frontend-supplied intervals

`get_usage_breakdown(request: UsageBreakdownRequest) -> UsageBreakdownResponse` — the same name
for the Tauri command and the Axum route (`/api/get_usage_breakdown`, added to the read-only
allowlist), registered in AN0b. AN0a ships the types only (`commands/stats/usage_breakdown.rs`,
`src/types/usageBreakdown.ts`); nothing is registered, so no caller can reach an unimplemented
command.

```
UsageBreakdownRequest {
  scope: { kind: "project", project_path, provider }
       | { kind: "all", providers, claude_path, custom_claude_paths },
  stats_mode: "billing_total" | "conversation_only",
  intervals: [{ key, start_utc, end_utc }],          // epoch ms, [start, end)
}
UsageBreakdownResponse {
  intervals: [{ key, models: [PricedModelStats], message_count, session_count }],
  sessions:  [{ ref: { provider, file_path, session_id, project_path }, title,
                models: [PricedModelStats], first_ts, last_ts, message_count }],
  coverage:  { providers: [{ id, status, sessions_scanned, sessions_failed,
                             sidechain_metadata, source_cost }],
               undated_rows, unknown_model_tokens },
}
PricedModelStats { pricing_source: "source" | "estimate", stats: ModelStats }
```

- **Roots and mode travel in the request.** `scope.kind = "all"` takes the same roots as
  `get_global_stats_summary` (default Claude root + user custom Claude paths) and the active
  provider list. `stats_mode` is the existing `StatsMode` (billing total vs conversation only);
  the transcript's sidechain display toggle is never used in its place. Unlike the old commands,
  an unknown `stats_mode` is a request error, not a silent default.
- **Request validation** (`UsageBreakdownRequest::validate`, pure): at least one and at most
  `MAX_INTERVALS` (1,000) intervals; every key non-empty and unique; `start_utc <= end_utc`;
  intervals sorted by start and pairwise non-overlapping (touching is allowed). Non-overlap is
  what makes "sum of intervals = the range counted once" true.
- **Every requested interval is returned**, in request order, with zero values when nothing
  happened. "No data" is never an interval value; it is a provider status in `coverage`.

### 2. Local-day intervals are computed by the frontend

`localDayIntervals({ from, to }, timeZone)` (`src/lib/usageBreakdown/localDayIntervals.ts`, pure,
`Intl.DateTimeFormat` only, no new dependency) returns one `[start, end)` interval per local date.
Rust gets no time-zone library; it only compares epoch milliseconds.

- **Start of a local day** = the first instant whose local wall time is at or after that date's
  00:00. A day whose midnight falls in a DST gap starts at the first instant after the gap; a day
  that does not exist (Pacific/Apia 2011-12-30) is a zero-length interval. Each interval ends
  where the next date starts, so intervals are contiguous and never overlap. A fold that crosses
  midnight assigns the repeated wall-clock span to the later date (its start is the earlier
  occurrence of 00:00).
- **Resolving a wall-clock time** (used for "same elapsed time" comparisons): a time inside a
  DST gap resolves to the first instant after the gap; a time inside a fold resolves to the
  earlier occurrence.
- **Previous period is calendar-based**: "last 7 days" compares against the 7 local dates right
  before it (same number of dates, not the same number of milliseconds).
- **Today in progress** is requested as `[today 00:00, now)`. For the change sentence the previous
  period's last day is cut at the same local wall time; to keep intervals non-overlapping that
  day is sent as two touching intervals (`[00:00, cut)` and `[cut, next 00:00)`) and the chart
  adds them back together. The previous-period chart line always uses whole days.
- **Time zone** is the zone at request time; the frontend cache key includes it and the scope line
  states it ("KST (UTC+9)"). A change of OS zone re-requests.
- The canonical location of `localDayIntervals` moves to `src/lib/format/` with F3b; this module
  then re-exports it. Its DST tests stay with it.

### 3. Half-open membership, millisecond floor

A row belongs to interval `[start, end)` iff `start <= ts_ms < end`, where `ts_ms` is the row
timestamp floored to whole milliseconds (`timestamp_ms_floor`). Because both edges are whole
milliseconds, flooring never changes membership: `…23:59:59.999999Z` is inside the day that ends
at the next midnight, and a row exactly at `end` belongs to the next interval only. A zero-length
interval (`start == end`) contains nothing. The old commands keep their inclusive end; they are
not changed.

### 4. Priced buckets keep the pricing source (`PricedModelStats`)

- The public `ModelStats` is unchanged and wrapped: a bucket is keyed by
  **(provider, model, service tier, pricing source)**, so one model can have two buckets in the
  same interval or session.
- The pricing source is decided **per dedup identity** — one API request/message, not a user
  conversation turn. The identity is `dedup_usage_key` inside the per-file state: (session,
  non-empty message id), else (session, non-empty uuid), the two kinds namespaced apart; a row
  with neither always counts on its own and is never merged. If any row of the identity
  reports a cost, all of its token growth is **source** and
  the cost counts once, on its first costed row (`dedup_source_cost`); otherwise it is
  **estimate**. So a streamed turn that repeats its full cost on every row while its output
  grows never leaks growth into an estimate bucket. A source bucket's `cost_usd` is the sum of
  the reported costs it received (it can be 0 when a turn's later rows fall in another
  interval than its costed row); an estimate bucket carries no `cost_usd` (absent on the wire).
- Every bucket keeps the full pricing dimensions: provider, service tier, reasoning tokens,
  5m/1h cache writes and the per-request `context_breakdown`.

### 5. One partial-cost policy, priced by the existing frontend function

- Source rows count at their reported value, every other priced row at the price-table estimate.
  The two parts are shown separately (`exactCost` / `estimatedCost`). Interval, range, session
  and turn totals all use this same policy.
- The frontend prices buckets by passing `bucket.stats` straight to the existing
  `calculateGlobalCostSummary` (`toCostInputs` only forces `cost_usd` off estimate buckets). No
  new price function exists.
- The estimate is linear in tokens per (model, tier, context tier), so splitting buckets by
  interval or session never changes the total (pinned by `pricedBuckets.additivity.test.ts`).
- A provider-reported cost is never spread over token classes. The composition view shows a
  source bucket as one line, "provider-reported cost (no per-class split)".
- Coverage keeps the existing definition: `coveredTokens / totalTokens`; tokens of models without
  a price are "out of range" (`unpricedTokens`), and sessions without any price are listed as
  "cannot estimate", not as $0.

### 6. Undated and model-less rows

- A row without a parseable timestamp is never placed in any interval or session total; it is
  only counted in `coverage.undated_rows`. The new pipeline never stamps `Utc::now()`.
- Tokens of rows without a model name stay in the totals under the existing `"unknown"` model
  bucket (unpriced) and are also counted in `coverage.unknown_model_tokens`.

### 7. Contributions, dedup and caching

- The unit of computation is one **usage contribution** per accepted request row: timestamp (ms),
  model index, service tier, the per-class token growth, context tier, deduped source cost and
  session index. Contributions are summed into whichever interval contains their timestamp.
- **Dedup runs over the whole file, before interval assignment.** The streamed-turn growth rule
  (#575) and the source-cost dedup (#283) keep one state per file; each contribution carries
  the growth of its own row, so a turn whose rows straddle two intervals is split without double
  counting and the interval sum equals the range counted once. (The old filtered scan dedups only
  the in-range rows; a turn straddling the range edge is therefore another intended difference
  and is excluded from old-vs-new equality.)
- **Cache**: one contribution list per Claude session file, keyed by canonical path and validated
  by `(size, mtime)` read **before** parsing (the existing cache rule). Budget ≈ 48 B per
  contribution, a 64 MiB global cap with LRU eviction. The existing UTC-day cache is untouched.
  Non-Claude providers are computed per request through their existing stats paths (their paths
  are virtual and have no file identity).
- **Rejected: hourly (or any fixed-width) UTC buckets.** They cannot represent Kolkata/Kathmandu
  midnights, `[today 00:00, now)` or a same-elapsed cut, so they would either be wrong or fall
  back to a full scan for exactly the intervals 4B asks for.

### 8. Reconciliation (tests come before the implementation)

1. **Inside the new API**: interval sum = range counted once = session sum (= turn sum once EV1a
   lands), for tokens and for cost, under the same bucket policy.
2. **Against the old commands only on fixtures where population and policy are the same**: every
   (provider, model, tier) is all-source or all-estimate, and no row is undated or on an
   interval edge. Then the full-range interval sum equals `get_project_stats_summary` /
   `get_global_stats_summary`, the session sum equals `get_project_token_stats` walked over
   **every** page until `has_more` is false, and per-model cost equals the old summary cost.
3. **Mixed source cost is an intended correction**: one model, two days (and two turns), a
   provider cost on one of them → new API = $4 ($1 exact + $3 estimated), old summary = $1. Both
   are asserted. The old summary keeps dropping the estimated part of a mixed group; fixing the
   old commands is a separate issue, outside this plan.
4. Dedup (#283 `dedup_usage_key`, `dedup_source_cost`, #575 growth) and subagent folding give
   the same totals as the old commands.
5. One session with several models and tiers, a source-cost-only provider, undated rows, rows
   without a model, and only some providers readable (`partial`).

Where undated rows exist, old-vs-new equality is not asserted; the test only checks that the
difference is explained by `coverage.undated_rows`.

### 9. Coverage

Per provider: `status` (`scanned` | `partial` | `unreadable` | `not_supported`),
`sessions_scanned`, `sessions_failed`, `sidechain_metadata` (whether the provider records
sidechains, so `conversation_only` means something), and `source_cost` (`all` | `some` | `none`
of its priced usage carried a provider cost). An unreadable provider is "out of range", never 0.

### 10. Blocking work and budgets

Computation runs in `spawn_blocking` with per-file parallelism; the frontend keeps the previous
result visible while loading (no blank screen). Budgets, measured in AN0b on the reference
fixture (25 projects + a synthetic 90-day, 50,000-message history), same machine, wall clock:

| Measure | Budget |
|---|---|
| Cold request | ≤ 3 s |
| Warm request | ≤ 300 ms |
| Contribution cache | ≤ 64 MiB |
| Response size (90 days, all projects) | ≤ 1 MiB |

A missed budget updates this ADR (new ADR superseding it) and is reported to the owner before
shipping — e.g. trimming `sessions` to the top n plus a remainder row.

## Consequences

- The overview, the range sum and the session list agree to the cent under one policy, and the
  mixed-source case shows $4 where the old summary shows $1. The two screens can disagree until
  AN2 moves the inspector token tab onto this API; the PR body and this ADR name that difference.
- The frontend owns time-zone math. Every request is explicit about its edges, so the backend
  stays deterministic and testable without a time-zone database.
- A second cache exists beside the UTC-day cache. It is bounded (64 MiB, LRU) and Claude-only.
- Reconciliation reference tests land in AN0a as `#[ignore = "AN0b"]` (Rust) and `it.todo`
  (TypeScript); AN0b turns them on. Tests that only exercise the old commands, the boundary
  predicates and the interval adapter are green now.
