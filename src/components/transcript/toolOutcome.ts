/**
 * Tool outcome model (plan §4.2, TR0) — RED-phase stub.
 *
 * The types are final; the functions return placeholders so the red tests
 * compile and fail on their assertions. The implementation follows in the
 * next commit.
 */

export type ToolLifecycle = "completed" | "interrupted" | "no-result";
export type ToolVerdict = "succeeded" | "failed" | "unknown";
export type OutcomeReason =
  | "no-result-recorded"
  | "interrupted"
  | "provider-error"
  | "api-error-code"
  | "error-content"
  | "exit-nonzero"
  | "exit-zero"
  | "conflict"
  | "no-error-signal"
  | "no-exit-code";

export interface ToolOutcome {
  lifecycle: ToolLifecycle;
  verdict: ToolVerdict;
  reason: OutcomeReason;
  exitCode?: number;
  errorCode?: string;
}

export type ToolFamily = "process" | "read-search" | "other";

export type ToolUseLike = Record<string, unknown>;
export type ToolResultLike = Record<string, unknown>;

export interface NormalizedResult {
  isError?: boolean;
  errorCode?: string;
  errorText?: string;
  exitCode?: number;
  exitCodeConflict?: true;
  interrupted?: boolean;
  stdout?: string;
  stderr?: string;
  text?: string;
}

export const ERROR_TEXT_PATTERN = /^error\b/i;

export function toolFamily(name: string): ToolFamily {
  void name;
  return "other";
}

export function normalizeResult(
  result: ToolResultLike,
  options: { bareCodeIsExitCode?: boolean } = {},
): NormalizedResult {
  void result;
  void options;
  return {};
}

export function toolOutcome(
  use: ToolUseLike | null,
  results: ToolResultLike[],
  family: ToolFamily,
): ToolOutcome {
  void [use, results, family];
  return { lifecycle: "completed", verdict: "unknown", reason: "no-error-signal" };
}

export function isToolRunEligible(
  use: ToolUseLike | null,
  results: ToolResultLike[],
  family: ToolFamily,
): boolean {
  void [use, results, family];
  return false;
}
