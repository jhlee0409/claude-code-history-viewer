/**
 * Usage-breakdown data contract (ADR 0002, `docs/adr/0002-usage-breakdown.md`).
 *
 * Wire types of the `get_usage_breakdown` command: priced usage per
 * frontend-supplied `[start, end)` interval and per session. Mirrors
 * `src-tauri/src/commands/stats/usage_breakdown.rs`; the shared fixture
 * `src/test/fixtures/usageBreakdown.contract.json` pins both sides.
 *
 * Registered as a Tauri command and an Axum route (read-only allowlist) of
 * the same name; AN1 is the first caller.
 */

import type { CustomClaudePath } from "./core/project";
import type { ModelStats } from "./stats.types";

/** Tauri command name and Axum route (`/api/get_usage_breakdown`). */
export const USAGE_BREAKDOWN_COMMAND = "get_usage_breakdown";

/** Same cap as the backend's `MAX_INTERVALS`. */
export const MAX_USAGE_INTERVALS = 1_000;

/**
 * Same cap as the backend's `MAX_SESSIONS` (ADR 0003): sessions listed per
 * response; the rest are merged into `session_remainder`.
 */
export const MAX_USAGE_SESSIONS = 100;

export type UsageScope =
  | { kind: "project"; project_path: string; provider: string }
  | {
      kind: "all";
      providers: string[];
      /** The default Claude root (`~/.claude`-shaped); empty means `~/.claude` itself. */
      claude_path: string;
      /** Same shape as `get_global_stats_summary`'s `customClaudePaths`. */
      custom_claude_paths: CustomClaudePath[];
    };

/** Existing stats mode, parsed strictly by the new command. */
export type UsageStatsMode = "billing_total" | "conversation_only";

/** Half-open `[start_utc, end_utc)` in epoch milliseconds. */
export interface UsageInterval {
  /** Unique per request, e.g. the local date `2026-10-17`. */
  key: string;
  start_utc: number;
  end_utc: number;
}

export interface UsageBreakdownRequest {
  scope: UsageScope;
  stats_mode: UsageStatsMode;
  /** Sorted, non-overlapping (touching allowed), 1..=MAX_USAGE_INTERVALS. */
  intervals: UsageInterval[];
}

/**
 * Decided per dedup identity — one API request/message (session + message
 * id, else uuid), not a user conversation turn.
 *
 * `source`: usage of identities with a provider-reported cost on at least
 * one row. All of the identity's growth is source, including rows without a
 * cost; its cost is charged once, on its first costed row, so
 * `stats.cost_usd` is the cost charged in this bucket and may be 0 when the
 * costed row lies in another interval. `estimate`: identities with no
 * reported cost; `stats.cost_usd` is absent and the price table applies.
 */
export type PricingSource = "source" | "estimate";

/** `ModelStats` wrapped with its pricing source (one model may have both). */
export interface PricedModelStats {
  pricing_source: PricingSource;
  stats: ModelStats;
}

export interface IntervalUsage {
  key: string;
  models: PricedModelStats[];
  message_count: number;
  session_count: number;
}

export interface SessionRef {
  provider: string;
  file_path: string;
  session_id: string;
  project_path: string;
}

export interface SessionUsage {
  ref: SessionRef;
  title: string | null;
  models: PricedModelStats[];
  /** First / last counted row inside the intervals, epoch ms. */
  first_ts: number;
  last_ts: number;
  message_count: number;
}

/**
 * Coverage status per provider (ADR 0002 §9, ADR 0003 §7), in the order of
 * the contract fixture's `provider_scan_statuses`:
 *
 * - `scanned`: the store was read completely (it may hold no usage);
 * - `partial`: some sessions, files or directories could not be read, or a
 *   symlink out of the history root was refused;
 * - `unreadable`: nothing could be read;
 * - `not_supported`: the history format records no token usage;
 * - `not_found`: no store of the provider on this machine, or the requested
 *   project directory does not exist — nothing to read, never a zero.
 */
export const PROVIDER_SCAN_STATUSES = [
  "scanned",
  "partial",
  "unreadable",
  "not_supported",
  "not_found",
] as const;

export type ProviderScanStatus = (typeof PROVIDER_SCAN_STATUSES)[number];

export type SourceCostCoverage = "all" | "some" | "none";

export interface ProviderCoverage {
  id: string;
  status: ProviderScanStatus;
  sessions_scanned: number;
  sessions_failed: number;
  sidechain_metadata: boolean;
  source_cost: SourceCostCoverage;
}

export interface UsageCoverage {
  providers: ProviderCoverage[];
  /** Rows without a parseable timestamp: in no interval or session total. */
  undated_rows: number;
  /** Tokens of rows without a model name (also in the `unknown` bucket). */
  unknown_model_tokens: number;
}

/**
 * The sessions of a response that `sessions` does not list (ADR 0003),
 * merged like an interval: one bucket per (provider, model, tier, pricing
 * source), so source and estimate stay apart. Always present; all zero with
 * no buckets when nothing was cut. `sessions` + this row = the intervals.
 */
export interface SessionRemainder {
  models: PricedModelStats[];
  message_count: number;
  session_count: number;
}

export interface UsageBreakdownResponse {
  intervals: IntervalUsage[];
  /**
   * At most `MAX_USAGE_SESSIONS`, ranked by cost (source + estimate, priced
   * like `summarizeBucketCost`), then tokens, then the latest `last_ts`,
   * then `ref` (ADR 0003).
   */
  sessions: SessionUsage[];
  session_remainder: SessionRemainder;
  coverage: UsageCoverage;
}

/** Arguments object for `api(USAGE_BREAKDOWN_COMMAND, …)` (Tauri and WebUI). */
export const usageBreakdownArgs = (
  request: UsageBreakdownRequest,
): { request: UsageBreakdownRequest } => ({ request });

type Keys<T> = Record<keyof T, true>;

/**
 * Field names of every new wire object. `satisfies` makes `tsc` fail when a
 * type gains or loses a field without this list; the contract test compares
 * the list with the shared JSON fixture, which the Rust test round-trips.
 */
export const USAGE_BREAKDOWN_WIRE_KEYS = {
  request: { scope: true, stats_mode: true, intervals: true } satisfies Keys<UsageBreakdownRequest>,
  projectScope: { kind: true, project_path: true, provider: true } satisfies Keys<
    Extract<UsageScope, { kind: "project" }>
  >,
  allScope: {
    kind: true,
    providers: true,
    claude_path: true,
    custom_claude_paths: true,
  } satisfies Keys<Extract<UsageScope, { kind: "all" }>>,
  customClaudePath: { path: true, label: true } satisfies Keys<CustomClaudePath>,
  interval: { key: true, start_utc: true, end_utc: true } satisfies Keys<UsageInterval>,
  response: {
    intervals: true,
    sessions: true,
    session_remainder: true,
    coverage: true,
  } satisfies Keys<UsageBreakdownResponse>,
  intervalUsage: {
    key: true,
    models: true,
    message_count: true,
    session_count: true,
  } satisfies Keys<IntervalUsage>,
  sessionRemainder: {
    models: true,
    message_count: true,
    session_count: true,
  } satisfies Keys<SessionRemainder>,
  pricedModelStats: { pricing_source: true, stats: true } satisfies Keys<PricedModelStats>,
  sessionUsage: {
    ref: true,
    title: true,
    models: true,
    first_ts: true,
    last_ts: true,
    message_count: true,
  } satisfies Keys<SessionUsage>,
  sessionRef: {
    provider: true,
    file_path: true,
    session_id: true,
    project_path: true,
  } satisfies Keys<SessionRef>,
  coverage: {
    providers: true,
    undated_rows: true,
    unknown_model_tokens: true,
  } satisfies Keys<UsageCoverage>,
  providerCoverage: {
    id: true,
    status: true,
    sessions_scanned: true,
    sessions_failed: true,
    sidechain_metadata: true,
    source_cost: true,
  } satisfies Keys<ProviderCoverage>,
} as const;
