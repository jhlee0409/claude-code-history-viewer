# 0003 — Usage breakdown: `sessions` capped at the top 100 by cost plus one remainder row

- **Status**: accepted
- **Date**: 2026-10-19
- **Supersedes**: [ADR 0002](0002-usage-breakdown.md) §10, the response-size line (≤ 1 MiB now
  holds on the reference fixture and is asserted). Narrows ADR 0002 §5 "No new price function
  exists" to displayed costs (§3 below). Amends ADR 0002 §9 (coverage): symlinks, unreadable
  parts of a root and the `not_found` status (§7 below). Everything else in ADR 0002 stands.
- **Plan reference**: inner-UI plan v3 §4.7 (budget: "세션 목록을 상위 n + 나머지 합으로"), §4.9
  (session detail), §5 rows AN1 and AN2.

## Context

AN0b measured the ADR 0002 §10 budgets on the reference fixture (25 projects, 90 KST days,
50,000 Claude rows, 1,000 sessions; Apple M4 Pro, release build). Time and memory were within
budget (cold 74 ms, warm 36.9 ms, contribution cache 2.69 MiB). The response was not: 1,941 KiB
against 1 MiB. `intervals` took 339 KiB; `sessions` took 1,602 KiB, about 1.6 KiB per session (a
source and an estimate bucket each, each with its `context_breakdown`). Session rows are the part
that grows with use: 250 sessions fit (724 KiB), 1,000 did not. ADR 0002 §10 offered three ways
out; the owner chose (a): list the top n sessions plus one remainder row, and change nothing else
in the contract.

The first cut was n = 250. The independent review of AN0b then measured it with every session
mixing models — a main model plus a small one is common — and the three-model response was
1,236.8 KiB, over the budget. n is 100 (§6).

Two facts shape the details:

- The overview's session table is "sessions by estimated cost" (plan §4.7; AN1: top 5 plus
  "n others"). A cut by tokens drops exactly the sessions that table is for: a session of cache
  reads on Haiku has many tokens and costs little, a short Opus session has few tokens and costs
  a lot. The cut has to rank by cost.
- Pricing lived only in the frontend (ADR 0002, Context); Rust had no price table.

## Decision

### 1. Response shape: one new field

```
UsageBreakdownResponse {
  intervals:         [...],                                  // unchanged
  sessions:          [SessionUsage],                         // at most MAX_SESSIONS, ranked (§2)
  session_remainder: { models: [PricedModelStats], message_count, session_count },
  coverage:          {...},                                  // unchanged
}
```

- `MAX_SESSIONS = 100` (Rust) and `MAX_USAGE_SESSIONS` (TypeScript). The shared contract fixture
  (`usageBreakdown.contract.json`, `limits`) pins both, and now pins `MAX_INTERVALS` the same way.
- The remainder merges every session that is not listed, bucket by bucket, under the same key as
  an interval: (provider, model, service tier, pricing source). Source and estimate buckets stay
  apart, each bucket keeps its `context_breakdown`, and a source bucket keeps its summed
  `cost_usd`.
- **Nothing cut: the remainder is present with zero values**, `{ "models": [], "message_count": 0,
  "session_count": 0 }`, never absent and never null. This is the interval rule of ADR 0002 §1
  (a row with zeros when nothing happened): `sessions` + `session_remainder` = `intervals` needs
  no branch, and `session_count > 0` means something was cut (every session in a response has at
  least one counted row).
- The cap applies to every response, whatever the scope and intervals. The request is unchanged,
  and the Tauri command and the Axum route still run the same function.

### 2. Order of `sessions`

1. Cost, descending: the provider-reported cost of source buckets plus the price-table estimate
   of estimate buckets, as `summarizeBucketCost(models).totalEstimatedCost` computes it (§3).
   An unpriced bucket counts 0.
2. Total tokens, descending.
3. `last_ts`, descending (latest activity first).
4. `ref`, ascending, field by field: provider, file_path, session_id, project_path.

The first `MAX_SESSIONS` are listed in this order, so equal inputs always give the same list.

### 3. The ranking cost mirrors the frontend's price function

To rank by cost the backend has to price. `usage_breakdown/ranking.rs` mirrors
`calculateGlobalCostSummary`, `calculateContextBreakdownPrice` and `findModelPricing`
(`globalCalculations.ts`, `calculations.ts`) over the same table, `src/data/model-pricing.json`,
embedded at compile time the way `menu/manifest.rs` embeds `src/commands/manifest.json`: longest
matching key, service tier (`priority` = `fast`), the context tier of each `context_breakdown`
entry, 5-minute and 1-hour cache-write rates, reasoning at the output rate, the
unsupported-model patterns and the source-cost-only providers. Same operations in the same
order, so both sides produce the same number.

- The value **only orders sessions**. It is not on the wire, and every cost the user sees is
  still computed by the frontend. ADR 0002 §5 therefore reads: no new price function for any
  displayed number; one ordering-only mirror in Rust.
- Drift guards:
  - the table is the same file, so a price edit reaches both sides;
  - the two rule lists that live in TypeScript code are read from `calculations.ts` by a Rust test
    (`rule_lists_match_the_frontend_pricing_module`);
  - the golden file records the backend's ranking cost of every listed session of every scenario,
    and `usageBreakdown.reconciliation.test.ts` asserts it equals `summarizeBucketCost` to 12
    digits (all 18 golden sessions are bit-identical today). Its `session_cap` scenario covers a
    fast tier, 1-hour cache writes, a long-context tier, provider cost, a mixed session and an
    unpriced model.
  - the pricing matrix covers the table, not only the scenarios: for every model in
    `model-pricing.json`, its base rates (every token class, with and without a breakdown), each
    context tier at and just below its threshold, each service tier and its context tiers, and a
    dated, decorated form of its name; plus the bucket rules (source cost, source-cost-only
    providers, token-unsupported models, name forms on a key whose shorter prefix key is priced
    differently). `pricing_matrix_tests.rs` writes the mirror's price of each case
    (`usageBreakdown.pricingMatrix.json`, 553 cases today); `usageBreakdown.pricingMatrix.test.ts`
    rebuilds every case and requires the same `f64` from `summarizeBucketCost`, and fails when the
    table has models or tiers the file does not cover. Six single-rule mutations of
    `calculations.ts` (the `@` and `:` separators, the context-tier threshold, the 1-hour write
    fallback, the `priority` alias, the bracket strip) all fail it; three of them (both
    separators and the bracket strip) pass the whole earlier frontend suite.
  - Not caught: a TypeScript rule that no case exercises (a new rule shape the matrix does not
    generate). It can only move sessions near the cut; it never changes a displayed number or a
    total.
- Rejected:
  - ranking by tokens: it cuts expensive light sessions, the case the overview table exists for;
  - prices in the request: a new request field the plan does not need.

### 4. Invariants (tests first)

- `sessions` + `session_remainder` = `intervals`, per bucket key: tokens and message counts
  exactly, provider cost within 1e-9. Priced by `summarizeBucketCost`, the exact, estimated and
  unpriced parts agree to the cent. Asserted over the cap
  (`cap_listed_sessions_plus_remainder_equal_interval_sums_to_the_cent`, golden `session_cap`)
  and under it (`an0b_interval_sum_equals_range_and_session_sums`, every other golden scenario).
- Listed sessions + `session_remainder.session_count` = the sessions with a counted row.
- Merging cut sessions into one row does not change their cost: the estimate is linear per
  (model, tier, context tier) (ADR 0002 §5).

### 5. Consumers that need a session that may be cut

- **AN1 overview** ("sessions by estimated cost", top 5 + "n others"; "the largest contributing
  session"): the top 5 are always listed, in the frontend's cost order. "n others" is
  `sessions.length − 5 + session_remainder.session_count`, and pricing the listed rest plus the
  remainder's buckets gives their exact cost.
- **Session detail sheet** (§4.9; reached from the overview table, the activity day list, the
  desktop inspector and the phone conversation menu): the sheet asks a narrower question
  instead of a new field. "In this project" requests `scope: { kind: "project", project_path,
  provider }` over the analytics period; share of project tokens, project session count and
  average per message stay exact (they come from `intervals` and the remainder). The session's
  own usage requests intervals around its own span. A session is cut from a project-scope
  response only when the project has more than 100 sessions with rows in the period and the
  session ranks below them. Ranks and percentiles ("3rd of 42 by tokens", duration rank) are
  exact only when `session_remainder.session_count == 0`; otherwise AN2 says they are among the
  listed sessions, or narrows the period. The plan does not require a new request field, so none
  is added.
- **Activity tab day list** (AN2): request that day's interval; the day's sessions are listed up
  to 100.

### 6. Budget (replaces the response-size line of ADR 0002 §10)

Reference fixture as in ADR 0002 §10 (25 projects, 90 KST days, 50,000 Claude rows, 1,000
sessions), release build, Apple M4 Pro, `cargo test --release --lib perf_budget -- --ignored
--nocapture --test-threads=1`. Three asserted runs: one model per session (the reference
fixture) and every session mixing two and three models.

| Measure (n = 100) | 1 model | 2 models | 3 models | Budget |
|---|---|---|---|---|
| Response size | **492.7 KiB** | **591.4 KiB** | **700.8 KiB** | ≤ 1 MiB, asserted in every run |
| · intervals | 339.4 KiB, 540 buckets | 339.7 KiB, 540 buckets | 339.4 KiB, 540 buckets | |
| · sessions | 149.1 KiB, 198 buckets | 247.6 KiB, 383 buckets | 357.2 KiB, 534 buckets | |
| · session_remainder | 3.9 KiB, 900 sessions | 3.9 KiB, 900 sessions | 3.9 KiB, 900 sessions | |
| Cold request | 116 ms | 77 ms | 311 ms | ≤ 3 s |
| Warm request (median of 5) | 40.1 ms | 20.2 ms | 34.4 ms | ≤ 300 ms |
| Contribution cache | 2.69 MiB | 2.74 MiB | 2.98 MiB | ≤ 64 MiB |

- **Why 100.** The cap bounds session rows, not their bytes, and a row grows with its buckets. At
  n = 250 the three runs measured 718.6, 965.6 and **1,236.8 KiB** (over; `sessions` 893.3 KiB
  of it). Everything but the session rows stays fixed as n changes, so the three-model response
  at n = 100 projects to (1,236.8 − 893.3) + 893.3 × 100 / 250 ≈ **700.8 KiB**, 31.6 % below the
  budget — and measures 700.8 KiB. About n = 190 is the largest three-model fit, with no margin.
  The one- and two-model projections (493.6 and 592.6 KiB) match their measurements within
  1.2 KiB. AN1 needs 5; AN2's lists ask narrower questions (§5).
- The three-model run is the gate: a change that pushes its response over 1 MiB — a larger n,
  or larger session rows — fails the test. The contract fixture pins n on both sides.
- The response size is deterministic and asserted whenever the (ignored) perf tests run, debug or
  release; time and memory are asserted in release builds. Timings vary from run to run (one run
  shown); sizes do not.
- History: the first cap (250) measured 718.6 KiB for one model (1,986.2 KiB uncut).

### 7. What a scan does not read (amends ADR 0002 §9)

Coverage says what was read; these rules decide what is read at all. They come from the AN0b
review, which reproduced each case through the read-only HTTP route.

**Symlinks are never followed inside a history root.** The Claude walk
(`commands/stats/session_files.rs`) is shared by the old stats commands and this command, so
both read the same file set: every `*.jsonl` entry under a project directory that is not a
symlink. A symlinked project directory under `projects/` is not walked either.

- The root a request names may itself be reached through a symlink (a symlinked `~/.claude`,
  #355). The HTTP route's root guard judges it by its canonical path; nothing inside it is
  followed.
- A skipped link that resolves inside one of the request's canonical roots is an **alias** of
  history that is read directly, so it is dropped silently (it used to be counted twice). Any
  other skipped link — out of the roots, or dangling — is **refused** and counts as a source
  that was not read: the provider is `partial` (or `unreadable` when nothing else was read),
  never `scanned`.
- Defense in depth: a file is opened only as a regular file whose canonical path lies inside the
  root it was found under, through its canonical path, and the opened handle must be the file
  that was checked (same device and inode on Unix). A file swapped for a symlink after the walk
  is not read. The contribution cache never answers a symlink with its target's entry.
- **The open decides, not the walk (#698).** A walk-time check and the open after it are
  separate system calls, so every history reader — the stats commands, search, the session,
  subagent and project lists, the session loaders, recent edits and the archive copy — opens
  through `session_files::open_session_file`: without following a symlink at the file
  (`O_NOFOLLOW`), without blocking on a FIFO (`O_NONBLOCK`, then the handle must be a regular
  file), inside the root resolved before the walk, and, where the system reports the opened
  handle's path (`F_GETPATH` on macOS, `/proc/self/fd` on Linux), that path inside the root as
  well. A reader handed a single file (one session's messages, its export) uses the file's own
  folder as the root (`open_history_file`). A unit test swaps a file for a symlink and for a
  FIFO right after its check, for every reader; a source guard fails on a plain open of a path
  in the readers' production code. Windows has no `O_NOFOLLOW`: the file is opened with
  `FILE_FLAG_OPEN_REPARSE_POINT`, so a link swapped in is opened as itself and refused by the
  handle's metadata; a folder on the way swapped for a junction between the containment check
  and the open is not detected there.
- **Hardlinks are read.** A hardlink is not a link entry but another name of the file itself: a
  regular file whose canonical path lies inside the root. A hardlink under a project directory to
  a file kept elsewhere on the same filesystem is therefore read like any other session file, by
  the old stats commands and this command alike. The containment above covers symlinks and paths
  that leave the root (`..`, an absolute path outside it), not hardlinks. This is inherent to
  reading history by path: making one needs write access inside the history root, and nothing in
  its path tells it apart from a session file.

**What a walk cannot read is reported.** An entry the Claude walk cannot read — a subdirectory
or project directory it may not list, an I/O error while listing `projects/` — counts as a
source that was not read: `partial` when something else was read, `unreadable` when nothing
was. Such errors used to be dropped, so a project whose only history sat in a mode-000
directory was `scanned` with zero usage.

**A store that is not there is `not_found`.** Coverage gains a fifth status: `not_found` — the
provider has no history store on this machine, or the requested project directory does not
exist. Nothing was read and nothing failed, which is neither `scanned` (a store that was read and
held no usage) nor `unreadable` (a store that exists but cannot be read).

- The existing provider scanners answer `Ok([])` for an empty store and for no store alike
  (Gemini, Pi, Qwen, …) and an error for some missing stores (Codex), so availability is decided
  before a scanner runs (`usage_breakdown/availability.rs`). Presence is the provider's own
  detection — `detect()`, the one the provider list uses — so no store layout is copied; the
  store root it names must also open, or the provider is `unreadable`.
- **Below the root, every token-reporting provider reports what its scan could not read** (a
  known limitation of AN0b, lifted by the follow-up). A scanner records each part of a present
  store it goes past without reading — a directory it may not list or look into, a session file
  it cannot open, a database it cannot open or read — in a `ScanReport`
  (`providers/scan_report.rs`), and each one is a source that was not read: `partial` when
  something else was read, `unreadable` when nothing was. A path that is not there is not a
  failure (nor one that vanished between a listing and the read), and content a scanner does not
  recognise (a table the store does not have, JSON that does not parse) is not a failure to read
  it. Before, the AN0b re-review reproduced Codex, OpenCode and Kilo as `scanned` with zero usage;
  `store_failure_tests` now locks (mode 000) each directory and file of a one-session store in
  turn, for every token-reporting provider, and requires `unreadable`. The old stats commands and
  the project tree do not use the reporting scanners; they keep the plain ones, so what they
  return is unchanged: a reporting scanner may answer a store it cannot read with nothing where
  the plain one fails (llm and Z Code, a database that cannot be opened), which only a caller
  that counts the report may do. `the_other_commands_answer_an_unreadable_store_as_before`
  holds the project scan, session list, search and old statistics of every store of the matrix
  (readable, absent, each part locked) to what develop answered.
- Detection only looks at paths, and a path it may not look into passes for an absent one. When
  `detect()` calls a store missing, its scanner still runs, on a probe: a probe that records a
  failure shows the store is there (`partial` / `unreadable`), one that records nothing leaves
  the provider `not_found`.
- Claude: none of the request's `projects/` folders exists → `not_found`; a root without one adds
  nothing. A custom root that fails validation is still a failed source.
- Wire: `ProviderScanStatus` in Rust and TypeScript, and the contract fixture's
  `provider_scan_statuses` lists all five values for both contract tests.

## Consequences

- The response is bounded by `intervals` plus 100 session rows: 492.7 KiB instead of
  1,986.2 KiB for 1,000 sessions, 700.8 KiB when every session mixes three models. Ranking and
  merging cost no measurable time.
- AN1 and AN2 treat `sessions` as the top 100 and `session_remainder` as the rest. A list that
  needs every session asks a narrower question: project scope, one day, or the session's span.
- The backend carries an ordering-only copy of the price rules. A rule change in
  `calculations.ts` has to be mirrored in `ranking.rs`; the guards in §3 catch the cases they
  cover. A price edit reaches both sides through the shared table; every price edit changes the
  pricing matrix, and one that touches a model the golden scenarios use (Sonnet 4.5, Haiku 5.5,
  Opus 5.5) changes the recorded ranking costs too: the Rust tests ask for
  `CCHV_UPDATE_GOLDEN=1`, which regenerates both files, and the diff shows the effect per rule. The `ranking.rs` unit tests read their
  expected rates from the table, so they survive price edits (one canonical check keeps Sonnet
  4.5 input at $3 / 1M, the example of ADR 0002 §8 (3) that the TypeScript tests already use).
- The cap bounds the number of session rows, not their bytes. No fixed n guarantees 1 MiB for any
  number of models or tiers per session, path and title lengths, or interval count; that would
  need byte-aware truncation and a policy for when `intervals` alone exceed the budget. n = 100 is
  sized on the reference fixture with up to three models per session, the case the gate asserts.
- The golden file and the pricing matrix are compared as text: the recorded costs are computed
  floats, and serde_json's default parser does not promise an exact round trip.
