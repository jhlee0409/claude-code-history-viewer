/**
 * Tool outcome model (plan §4.2, TR0).
 *
 * A tool call has a **lifecycle** (did a result arrive, was it interrupted)
 * and a **verdict** (did it succeed). They are separate on purpose: a result
 * that arrived without any evidence of success is `completed` / `unknown`,
 * never "Completed" in green.
 *
 * `normalizeResult` is the only reader of tool-result shapes in the
 * transcript UI (`resultAdapter.import.test.ts` scans for others). It reads
 * the block itself and its own per-result metadata from the #727 contract
 * (docs/contracts/tool-result-metadata.md): `toolUseResult` when the source
 * record held exactly that one result (`association: "single_result"`). An
 * `unassigned` payload belongs to a multi-result source record and is never
 * attributed to any single result.
 *
 * Present `0`, `false`, `""`, `null` and absent stay distinct, and nothing is
 * synthesized: no exit code from stderr or from prose like "Exit code 1".
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
  /** The recorded exit code (non-zero wins when recorded codes disagree). */
  exitCode?: number;
  /** A recorded API error code (`error_code`), shown as "Failed · <code>". */
  errorCode?: string;
}

/**
 * process: has an exit code (shell, exec, code execution).
 * read-search: reads or searches; their errors are recorded only as error
 * signals, so "a result and no error signal" is their evidence of success.
 * other: edits, MCP, agents … — completed but unknown unless an error or an
 * exit code is recorded.
 */
export type ToolFamily = "process" | "read-search" | "other";

export type ToolUseLike = Record<string, unknown>;
export type ToolResultLike = Record<string, unknown>;

export interface NormalizedResult {
  /** `is_error` as recorded: `true`, `false`, or absent. */
  isError?: boolean;
  /** API error code (`error_code`) from the content object or own metadata. */
  errorCode?: string;
  /** The content string when it is an error message (`^error\b`). */
  errorText?: string;
  /** A recorded integer exit code. */
  exitCode?: number;
  /** Two recorded exit codes for this one result disagree. */
  exitCodeConflict?: true;
  interrupted?: boolean;
  stdout?: string;
  stderr?: string;
  /** The block's content when it is a plain string, as recorded. */
  text?: string;
}

/** The existing error-string rule (shared with `unifiedCards/shared.ts` `isError`). */
export const ERROR_TEXT_PATTERN = /^error\b/i;

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

const PROCESS_TOOLS = new Set([
  "bash",
  "shell",
  "exec",
  "exec_command",
  "local_shell",
  "run_shell_command",
  "run_terminal_cmd",
  "terminal",
  "code_execution",
  "bash_code_execution",
]);

const READ_SEARCH_TOOLS = new Set([
  "read",
  "read_file",
  "grep",
  "glob",
  "ls",
  "list_dir",
  "list_directory",
  "file_list",
  "websearch",
  "web_search",
  "webfetch",
  "web_fetch",
]);

export function toolFamily(name: string): ToolFamily {
  const key = name.toLowerCase();
  if (PROCESS_TOOLS.has(key)) return "process";
  if (READ_SEARCH_TOOLS.has(key)) return "read-search";
  return "other";
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Explicit exit-code names, in priority order. */
const EXIT_CODE_KEYS = ["exitCode", "exit_code", "return_code", "returncode"] as const;

/**
 * The result's own metadata: `toolUseResult` only when the source record held
 * exactly this result. A payload beside an `unassigned` envelope, or without
 * a source, is not per-result evidence.
 */
function ownMetadata(result: ToolResultLike): Record<string, unknown> | null {
  const source = result.toolUseResultSource;
  if (!isPlainObject(source) || source.association !== "single_result") return null;
  const own = result.toolUseResult;
  return isPlainObject(own) ? own : null;
}

const recordedInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;

/**
 * Flatten one result block. `bareCodeIsExitCode` lets the ambiguous `code`
 * name count as an exit code; only process tools ask for it, because a
 * WebFetch result records its HTTP status as `code: 200`.
 */
export function normalizeResult(
  result: ToolResultLike,
  options: { bareCodeIsExitCode?: boolean } = {},
): NormalizedResult {
  const out: NormalizedResult = {};
  const content = result.content;
  const contentObject = isPlainObject(content) ? content : null;
  const own = ownMetadata(result);
  const nested = (o: Record<string, unknown> | null) => (o && isPlainObject(o.result) ? o.result : null);
  // Where the fields may sit: own metadata, the content object, then a nested
  // `result` object inside either.
  const sources = [own, contentObject, nested(own), nested(contentObject)].filter(
    (s): s is Record<string, unknown> => s !== null,
  );

  if (typeof result.is_error === "boolean") out.isError = result.is_error;

  for (const source of [contentObject, own]) {
    if (source && typeof source.error_code === "string" && source.error_code.length > 0) {
      out.errorCode = source.error_code;
      break;
    }
  }

  if (typeof content === "string") {
    out.text = content;
    if (ERROR_TEXT_PATTERN.test(content)) out.errorText = content;
  }

  const keys: readonly string[] = options.bareCodeIsExitCode ? [...EXIT_CODE_KEYS, "code"] : EXIT_CODE_KEYS;
  const codes: number[] = [];
  for (const source of sources) {
    for (const key of keys) {
      const code = recordedInteger(source[key]);
      if (code !== undefined) codes.push(code);
    }
  }
  if (codes.length > 0) {
    out.exitCode = codes.find((c) => c !== 0) ?? codes[0];
    if (new Set(codes).size > 1) out.exitCodeConflict = true;
  }

  for (const source of sources) {
    if (typeof source.interrupted === "boolean") {
      out.interrupted = source.interrupted;
      if (source.interrupted) break;
    }
  }

  for (const source of sources) {
    if (typeof source.stdout === "string") {
      out.stdout = source.stdout;
      break;
    }
  }
  for (const source of sources) {
    if (typeof source.stderr === "string") {
      out.stderr = source.stderr;
      break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The verdict (plan §4.2 order: the first rule that applies wins)
// ---------------------------------------------------------------------------

export function toolOutcome(
  use: ToolUseLike | null,
  results: ToolResultLike[],
  family: ToolFamily,
): ToolOutcome {
  // An orphan (use === null) is judged by its result alone; the pairing only
  // matters for `toolRun` eligibility.
  void use;
  // 1. No result at all.
  if (results.length === 0) return { lifecycle: "no-result", verdict: "unknown", reason: "no-result-recorded" };

  const normalized = results.map((r) => normalizeResult(r, { bareCodeIsExitCode: family === "process" }));
  const codes = normalized.flatMap((n) => (n.exitCode === undefined ? [] : [n.exitCode]));
  const exitCode = codes.find((c) => c !== 0) ?? codes[0];
  const codesDisagree = new Set(codes).size > 1 || normalized.some((n) => n.exitCodeConflict === true);
  const withExit = (o: ToolOutcome): ToolOutcome => (exitCode === undefined ? o : { ...o, exitCode });

  // 2. Interrupted.
  if (normalized.some((n) => n.interrupted === true)) {
    const verdict = exitCode !== undefined && exitCode !== 0 ? "failed" : "unknown";
    return withExit({ lifecycle: "interrupted", verdict, reason: "interrupted" });
  }

  // 3. Recorded error signals; an exit code 0 beside one is a conflict.
  const providerError = normalized.some((n) => n.isError === true);
  const errorCode = normalized.find((n) => n.errorCode !== undefined)?.errorCode;
  const errorContent = normalized.some((n) => n.errorText !== undefined);
  if (providerError || errorCode !== undefined || errorContent) {
    const reason: OutcomeReason =
      exitCode === 0 || codesDisagree
        ? "conflict"
        : providerError
          ? "provider-error"
          : errorCode !== undefined
            ? "api-error-code"
            : "error-content";
    const outcome = withExit({ lifecycle: "completed", verdict: "failed", reason });
    return errorCode === undefined ? outcome : { ...outcome, errorCode };
  }

  // 4. A recorded exit code decides; `is_error: false` beside a non-zero code
  //    is a conflict the exit code wins.
  if (exitCode !== undefined) {
    if (exitCode === 0 && !codesDisagree) return { lifecycle: "completed", verdict: "succeeded", reason: "exit-zero", exitCode };
    const recordedNoError = normalized.some((n) => n.isError === false);
    const reason: OutcomeReason = recordedNoError || codesDisagree ? "conflict" : "exit-nonzero";
    return { lifecycle: "completed", verdict: "failed", reason, exitCode };
  }

  // 5. No error signal and no exit code. (6. stderr never decides.)
  if (family === "process") return { lifecycle: "completed", verdict: "unknown", reason: "no-exit-code" };
  if (family === "read-search") return { lifecycle: "completed", verdict: "succeeded", reason: "no-error-signal" };
  return { lifecycle: "completed", verdict: "unknown", reason: "no-error-signal" };
}

/**
 * May this call fold into a `toolRun` (TR3 draws the fold)? Only a read or
 * search call whose tool_use and result are both in the loaded window and
 * whose verdict is `succeeded`. Everything else breaks a run and stays open.
 */
export function isToolRunEligible(
  use: ToolUseLike | null,
  results: ToolResultLike[],
  family: ToolFamily,
): boolean {
  if (use === null || results.length === 0 || family !== "read-search") return false;
  return toolOutcome(use, results, family).verdict === "succeeded";
}
