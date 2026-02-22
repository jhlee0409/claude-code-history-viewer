# Token Stats Consistency Plan

## Goal
Establish one consistent token accounting policy across global, project, and session analytics so totals are explainable and reconcilable.

## Why this is needed
Current analytics paths use different filtering and parsing rules, causing user-visible mismatches.

## Current inconsistency map
- Global stats skip sidechain messages (`isSidechain == true`) in Claude path.
- Project stats and project token stats do not apply the same sidechain exclusion.
- Session token stats path excludes system-type messages through `load_session_messages`, but project token paths aggregate through different logic.
- Global Claude path uses a lightweight extractor that is not guaranteed to match the full extractor behavior used elsewhere.

## Target invariants
- The same message eligibility rule must be used for global, project, and session aggregation.
- The same token extraction precedence must be used for global, project, and session aggregation.
- Global totals must equal the sum of project totals under the same filters.
- Project totals must equal the sum of session totals under the same filters.
- Provider filtering and sidechain filtering must be explicit and traceable in API inputs.

## Canonical accounting policy (recommended)
- Metric mode `billing_total` (default for analytics): include sidechain usage because it is billed usage.
- Metric mode `conversation_only` (optional UI mode): exclude sidechain to reflect only main-thread context.
- Include token components: input, output, cache_creation_input, cache_read_input.
- Include entries from supported token locations with deterministic precedence:
1. `message.usage`
2. `toolUseResult.usage`
3. `toolUseResult.totalTokens` fallback
- Exclude non-message noise types unless they carry token usage fields in supported locations.

## API contract changes
- Add optional `stats_mode` argument to analytics commands.
- Target commands: `get_global_stats_summary`, `get_project_stats_summary`, `get_project_token_stats`, `get_session_token_stats`.
- Allowed values: `billing_total`, `conversation_only`.
- Default: `billing_total`.

## Implementation plan

### Phase 1: Shared aggregator extraction (Rust)
- Create a shared stats aggregation module for message eligibility, token extraction, and token accumulation.
- Replace ad-hoc per-command aggregation branches with shared helpers.
- Files: `src-tauri/src/commands/stats.rs`, `src-tauri/src/commands/stats_aggregate.rs` (new).

### Phase 2: Command wiring
- Thread `stats_mode` through all four command entry points.
- Ensure provider-specific paths (Claude/Codex/OpenCode) use same aggregation policy.
- Keep existing command names for backward compatibility; add optional params only.

### Phase 3: Frontend wiring
- Extend analytics API service to pass `statsMode`.
- Add store-level default (`billing_total`) and optional toggle in analytics UI.
- Ensure global/project/session views share the same mode source.
- Files: `src/services/analyticsApi.ts`, `src/store/slices/globalStatsSlice.ts`, `src/store/slices/messageSlice.ts`, `src/components/AnalyticsDashboard/*`.

### Phase 4: Test hardening
- Add fixture-driven reconciliation tests with sidechain + toolUseResult usage cases.
- Add cross-level equality tests: global == sum(project), project == sum(session).
- Add provider path parity tests (Claude/Codex/OpenCode where fixtures allow).
- Files: `src-tauri/src/commands/stats.rs` tests (or dedicated test module), frontend tests for mode propagation in store/service.

## Acceptance criteria
- With identical date/provider filters and same `stats_mode`, totals reconcile.
- Global total tokens == sum of all project total tokens.
- Project total tokens == sum of all session total tokens.
- Sidechain inclusion behavior changes only with `stats_mode`, not by screen.
- No regression in performance beyond acceptable bounds.
- Global stats path p95 latency increase <= 15% on representative dataset.

## Verification commands
- Rust format/lint/tests: `cd src-tauri && cargo fmt --all -- --check`, `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`, `cd src-tauri && cargo test -- --test-threads=1`.
- Frontend type/lint/tests: `pnpm lint`, `pnpm tsc --build .`, `pnpm vitest run --reporter=verbose`.

## Rollout and risk control
- Keep `stats_mode` default stable as `billing_total`.
- If UI toggle is introduced, gate with clear label and tooltip to prevent interpretation errors.
- Add debug logging guard in dev mode to print reconciliation deltas when non-zero.

## Out of scope for this change
- External billing reconciliation against provider-admin APIs.
- Historical migration or rewriting persisted analytics snapshots.

## Deliverables
- Shared aggregation implementation.
- Optional `stats_mode` contract support end-to-end.
- Regression tests proving reconciliation invariants.
- Short release note describing changed token accounting semantics.

## PR slicing (recommended)
- PR 1: Rust shared aggregator + command parameter wiring + backend tests.
- PR 2: Frontend service/store wiring for `stats_mode` + UI toggle (if enabled).
- PR 3: Reconciliation/perf hardening tests + docs/changelog updates.

## Execution checklist
- [x] Implement shared aggregator logic and replace duplicated stats paths in `stats.rs`.
- [x] Add `stats_mode` optional input in Tauri command signatures.
- [x] Wire `stats_mode` through frontend API calls and store defaults.
- [x] Add reconciliation tests for sidechain and tool result usage.
- [x] Run verification commands (`cargo fmt`, `cargo clippy`, `cargo test -- --test-threads=1`).

## Progress snapshot (2026-02-22)
- Backend aggregation policy is unified with explicit mode handling (`billing_total` default, `conversation_only` optional).
- Cross-level consistency test is implemented and passing (global/project/session totals reconcile per mode).
- Benchmark call sites were updated to match new command signatures.
- Frontend now exposes a mode selector and threads `stats_mode` through global/project/session APIs.
- Provider scope intentionally remains tied to ProjectTree provider tabs to avoid filter conflicts.
- Global analytics now includes provider-level distribution and an estimated-cost metric mode with reliability badges (estimated/coverage/last-updated).
- Stats mode toggle is removed from UI; billing view is primary and explicitly broken down as `Billing Total = Conversation Only + Sidechain`.

## Decision note
- If UI toggle is deferred, keep backend `stats_mode` support and fix mode to `billing_total` in frontend.
- This still resolves cross-view inconsistency while minimizing UI churn.
