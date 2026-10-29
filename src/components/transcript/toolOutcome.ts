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
 * the block itself and the block's own inline `toolUseResult` from the #727
 * contract (docs/contracts/tool-result-metadata.md). That inline field is the
 * block's evidence whatever its provenance envelope says, and with no
 * envelope at all: `association` describes where the source record's *outer*
 * payload went. The outer payload of an ambiguous record
 * (`toolUseResultSource.unassignedToolUseResult`) belongs to no single result
 * and is never read.
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
  | "provider-completed"
  | "no-exit-code";

export interface ToolOutcome {
  lifecycle: ToolLifecycle;
  verdict: ToolVerdict;
  reason: OutcomeReason;
  /** The recorded exit code (non-zero wins when recorded codes disagree). */
  exitCode?: number;
  /**
   * A recorded API error code (`error_code`): "Failed · <code>" in the row,
   * or a fact of the opened detail when the row says something else
   * (an interruption).
   */
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
  /** Source-owned OpenCode-core tool state, never a session/process status. */
  completed?: boolean;
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

/** The existing error-string rule: a result whose content starts with `error`. */
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
  "shell_command",
  "run",
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
 * The result's own metadata: its inline `toolUseResult`. The backend copies
 * the record's payload there only for a `single_result` record and never
 * overwrites a field the block already had, so an inline field is this
 * block's own under any envelope. `toolUseResultSource` (and the
 * `unassignedToolUseResult` it may carry) is deliberately not consulted.
 */
function ownMetadata(result: ToolResultLike): Record<string, unknown> | null {
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
  options: { bareCodeIsExitCode?: boolean; provider?: string } = {},
): NormalizedResult {
  const out: NormalizedResult = {};
  const content = result.content;
  const contentObject = isPlainObject(content) ? content : null;
  const own = ownMetadata(result);
  const nested = (o: Record<string, unknown> | null) => (o && isPlainObject(o.result) ? o.result : null);
  // Where the fields may sit: own metadata, the content object, then a nested
  // `result` object inside either.
  const legacy = options.provider === undefined || options.provider === "claude";
  const codex = options.provider === "codex" || options.provider === "openinterpreter";
  const openhands = options.provider === "openhands";
  const core = options.provider === "opencode" || options.provider === "kilo";
  // #749 has distinct source contracts. Opaque Pi details and OpenCode
  // extension metadata are deliberately NOT generic execution schemas.
  const metadata = own && isPlainObject(own.metadata) ? own.metadata : null;
  const sources = (legacy ? [own, contentObject, nested(own), nested(contentObject)] : codex ? [own, metadata, contentObject] : openhands ? [metadata] : []).filter(
    (s): s is Record<string, unknown> => s !== null,
  );

  if (typeof result.is_error === "boolean") out.isError = result.is_error;
  // Legacy MCP router records carry an explicit error union. This is not a
  // generic `error`-key heuristic: other providers keep their opaque schemas.
  if (legacy && contentObject &&
    (contentObject.type === "mcp_tool_call" || typeof contentObject.server === "string") &&
    (typeof contentObject.method === "string" || typeof contentObject.function === "string")) {
    const error = contentObject.error;
    if (error === true || (typeof error === "string" && error.length > 0) || isPlainObject(error)) out.isError = true;
  }
  if (core && own) {
    if (own.status === "completed") out.completed = true;
    if (own.status === "error") out.isError = true;
    if (own.status === "cancelled") out.interrupted = true;
  }
  if ((options.provider === "pi" || options.provider === "ompi") && typeof own?.isError === "boolean" && own.isError) out.isError = true;

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
// The content, as ordered parts for display
// ---------------------------------------------------------------------------

/**
 * One part of a result's recorded content, in recorded order: a run of
 * contiguous text, or a run of contiguous non-text values (image, document,
 * search_result, unknown blocks, objects) for the existing result renderers.
 * `generic` marks a stream-shaped object the stream path did not fully show
 * (an extra key, a value it did not use): it goes to the generic fallback as
 * recorded, because the result router would draw it as a stream card again
 * and leave out the very fields that kept it visible.
 */
export type ContentPart =
  | { kind: "text"; text: string }
  | { kind: "other"; value: unknown[] | Record<string, unknown>; generic?: true };

/** What a result's `content` records, as parts. Nothing is reordered or dropped. */
export interface ResultContent {
  /** `content` is present (not `undefined` / `null`). */
  recorded: boolean;
  parts: ContentPart[];
}

/** Fields of a stream record besides the exit-code aliases. */
const STREAM_FIELDS = ["stdout", "stderr", "interrupted", "isImage", "error_code"] as const;

const blockText = (block: unknown): string | null => {
  if (typeof block === "string") return block;
  if (isPlainObject(block) && block.type === "text" && typeof block.text === "string") return block.text;
  return null;
};

/**
 * Is `o` exactly what the stream path shows for this result? Every key must
 * be a stream / outcome field `normalizeResult` reads at this level, holding
 * the value it shows (`shown`); `result` may hold one more such record (the
 * normalizer reads one level down, no deeper). `isImage` is a flag the
 * normalizer knows and shows nothing for. Anything else — an extra key, a
 * deeper `result`, a value of another type or one another source outranked,
 * an empty object — is not consumed and stays in the parts.
 */
function consumedByStreams(o: Record<string, unknown>, shown: NormalizedResult, exitKeys: readonly string[], nested: boolean): boolean {
  const entries = Object.entries(o);
  return entries.length > 0 && entries.every(([key, value]) => {
    if (key === "stdout") return typeof value === "string" && value === shown.stdout;
    if (key === "stderr") return typeof value === "string" && value === shown.stderr;
    if (exitKeys.includes(key)) return recordedInteger(value) !== undefined && value === shown.exitCode && shown.exitCodeConflict !== true;
    if (key === "interrupted") return typeof value === "boolean" && value === shown.interrupted;
    if (key === "isImage") return typeof value === "boolean";
    if (key === "error_code") return !nested && typeof value === "string" && value === shown.errorCode;
    if (key === "result") return !nested && isPlainObject(value) && consumedByStreams(value, shown, exitKeys, true);
    return false;
  });
}

/**
 * The result's content as ordered parts. Contiguous text runs (a string, or
 * text blocks joined by "\n") and contiguous non-text runs each become one
 * part, in recorded order. A content object is left out only when
 * `consumedByStreams` says the stream path already shows all of it.
 */
export function resultContent(result: ToolResultLike, options: { bareCodeIsExitCode?: boolean; provider?: string } = {}): ResultContent {
  const content = result.content;
  if (content === undefined || content === null) return { recorded: false, parts: [] };
  if (typeof content === "string") return { recorded: true, parts: [{ kind: "text", text: content }] };
  if (Array.isArray(content)) {
    const parts: ContentPart[] = [];
    let texts: string[] = [];
    let others: unknown[] = [];
    const flushTexts = () => {
      if (texts.length > 0) parts.push({ kind: "text", text: texts.join("\n") });
      texts = [];
    };
    const flushOthers = () => {
      if (others.length > 0) parts.push({ kind: "other", value: others });
      others = [];
    };
    for (const block of content) {
      const text = blockText(block);
      if (text === null) {
        flushTexts();
        others.push(block);
      } else {
        flushOthers();
        texts.push(text);
      }
    }
    flushTexts();
    flushOthers();
    return { recorded: true, parts };
  }
  if (isPlainObject(content)) {
    const text = blockText(content);
    if (text !== null) return { recorded: true, parts: [{ kind: "text", text }] };
    const exitKeys: readonly string[] = options.bareCodeIsExitCode ? [...EXIT_CODE_KEYS, "code"] : EXIT_CODE_KEYS;
    if (consumedByStreams(content, normalizeResult(result, options), exitKeys, false)) return { recorded: true, parts: [] };
    const streamKeys = new Set([...STREAM_FIELDS, ...exitKeys]);
    const streamShaped = (o: Record<string, unknown>) => Object.keys(o).some((key) => streamKeys.has(key));
    const generic = streamShaped(content) || (isPlainObject(content.result) && streamShaped(content.result));
    return { recorded: true, parts: [generic ? { kind: "other", value: content, generic: true } : { kind: "other", value: content }] };
  }
  // A number or boolean content: shown as recorded.
  return { recorded: true, parts: [{ kind: "text", text: String(content) }] };
}

/**
 * Claude's Write confirmation, as its tool records it (real history:
 * "File created successfully at: <path>" and "The file <path> has been
 * updated successfully.", either optionally followed by the note below).
 */
const WRITE_CONFIRMATION = /^(?:File created successfully at: (.+?)|The file (.+?) has been updated successfully\.)(?: \(file state is current in your context — no need to Read it back\))?$/;

/**
 * The path a Write result confirms, when its whole content is exactly that
 * confirmation sentence (a string or one text block) and nothing records an
 * error; otherwise `null`, and the result is shown as recorded (renderer
 * audit TC15).
 */
export function writeConfirmationPath(result: ToolResultLike): string | null {
  if (result.is_error === true) return null;
  const content = result.content;
  const text = Array.isArray(content) ? (content.length === 1 ? blockText(content[0]) : null) : blockText(content);
  if (text === null) return null;
  const match = WRITE_CONFIRMATION.exec(text.replace(/\n+$/, ""));
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * Claude's Edit confirmation, as its tool records it: "The file <path> has
 * been updated successfully." (real history, optionally with the
 * "file state is current" note), the shorter "The file <path> has been
 * updated.", and the older sentence without its `cat -n` snippet (the
 * harness fixtures' shapes). A sentence followed by a
 * snippet, or by any other note ("the file had been modified on disk …"),
 * records more than the diff shows and is not a confirmation.
 */
const EDIT_CONFIRMATION =
  /^(?:The file (.+?) has been updated(?: successfully)?\.(?: \(file state is current in your context — no need to Read it back\))?|The file (.+?) has been updated\. Here's the result of running `cat -n` on a snippet of the edited file[.:]?)$/;

/**
 * The path an Edit / MultiEdit result confirms, when its whole content is
 * exactly that confirmation sentence (a string or one text block) and
 * nothing records an error; otherwise `null`: the result is shown as
 * recorded (review round 1 of PR #746, F1).
 */
export function editConfirmationPath(result: ToolResultLike): string | null {
  if (result.is_error === true) return null;
  const content = result.content;
  const text = Array.isArray(content) ? (content.length === 1 ? blockText(content[0]) : null) : blockText(content);
  if (text === null) return null;
  const match = EDIT_CONFIRMATION.exec(text.replace(/\n+$/, ""));
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * The results without the confirmation sentences (`confirms` gives the path
 * a result confirms, or null) that name `filePath`, the row's own file —
 * the one thing a Write / Edit row already says. A confirmation's own
 * stdout / stderr still render (its content emptied); any other result is
 * passed as is.
 */
export function withoutOwnConfirmations(
  results: ToolResultLike[],
  filePath: string,
  confirms: (result: ToolResultLike) => string | null,
): ToolResultLike[] {
  return results.flatMap((result) => {
    if (filePath === "" || confirms(result) !== filePath) return [result];
    const n = normalizeResult(result);
    const streamText = (n.stdout ?? "") !== "" || (n.stderr ?? "") !== "";
    return streamText ? [{ ...result, content: "" }] : [];
  });
}

/**
 * Is this text part only the JSON echo of the result's own recorded API
 * error code (WebFetch / WebSearch `url_not_accessible`: content
 * `{"error_code":"url_not_accessible"}` beside `toolUseResult.error_code`)?
 * The row already says "Failed · <code>"; showing the echo would state the
 * same fact a second time in a JSON box (renderer audit NC1, amendment 7).
 * Any other key, another value, or text around the object is not an echo.
 */
function isErrorCodeEcho(part: ContentPart, errorCode: string | undefined): boolean {
  if (part.kind !== "text" || errorCode === undefined) return false;
  const trimmed = part.text.trim();
  if (!trimmed.startsWith("{")) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  return isPlainObject(parsed) && Object.keys(parsed).length === 1 && parsed.error_code === errorCode;
}

/**
 * The results as the opened detail shows them: a result whose content is
 * only the echo of its own recorded error code (`isErrorCodeEcho`) loses
 * that content, nothing else. With stream text beside it the result stays
 * (content emptied, its streams still render); without, there is nothing
 * left to show and it is left out. Every other result is passed as is.
 */
export function withoutErrorCodeEcho(results: ToolResultLike[]): ToolResultLike[] {
  return results.flatMap((result) => {
    const n = normalizeResult(result);
    const content = resultContent(result);
    if (!content.recorded || content.parts.length === 0 || !content.parts.every((part) => isErrorCodeEcho(part, n.errorCode))) return [result];
    const streamText = (n.stdout ?? "") !== "" || (n.stderr ?? "") !== "";
    return streamText ? [{ ...result, content: "" }] : [];
  });
}

/**
 * Whether the opened detail shows anything for these results: every result
 * `ToolResultOutputs` keeps after `withoutErrorCodeEcho` renders something
 * (its parts, its stream zones, "No output", or the old result router). A
 * call whose only result echoed its error code — already said in the row —
 * has no Result zone.
 */
export function hasShownResults(results: ToolResultLike[]): boolean {
  return withoutErrorCodeEcho(results).length > 0;
}

/**
 * The first recorded text of the results, wherever it sits: a string
 * content, or the first text block of a content array (one block, not the
 * run). `null` when none records text. A value to read (the Workflow run id),
 * never a slot to render: a card that shows a text apart from the other parts
 * takes it with `splitLeadingResultText`, which keeps the recorded order.
 */
export function firstResultText(results: ToolResultLike[]): string | null {
  for (const result of results) {
    const content = result.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isPlainObject(block) && block.type === "text" && "text" in block) return String(block.text);
      }
    }
  }
  return null;
}

/** A card's leading result text and every part after it (`splitLeadingResultText`). */
export interface LeadingResultText {
  /** The text the results record first, or `null` when their first part is not text. */
  text: string | null;
  /** Everything else, in recorded order: all the results when `text` is null. */
  rest: ToolResultLike[];
}

/**
 * The text a card may show on its own (the Agent card's prose) and the parts
 * that follow it (review round 2 of PR #746, R2-F1). Only the very first part
 * the results record can be lifted: the first result's string content, or
 * the first block of its content array when that block is text. Then `rest`
 * is that result's other blocks and streams, and every later result, in
 * recorded order (a result left with neither is dropped: nothing of it
 * remains). When the first part is anything else (an image, a document, an
 * empty first result, no content) nothing is lifted and `rest` is the results
 * as recorded, so a text is never shown ahead of a part recorded before it.
 */
export function splitLeadingResultText(results: ToolResultLike[]): LeadingResultText {
  const [first, ...later] = results;
  if (!first) return { text: null, rest: [] };
  const content = first.content;
  const lead = Array.isArray(content) ? content[0] : undefined;
  let text: string;
  let remaining: unknown[];
  if (typeof content === "string") {
    text = content;
    remaining = [];
  } else if (Array.isArray(content) && isPlainObject(lead) && lead.type === "text" && "text" in lead) {
    text = String(lead.text);
    remaining = content.slice(1);
  } else {
    return { text: null, rest: results };
  }
  const n = normalizeResult(first);
  const streamText = (n.stdout ?? "") !== "" || (n.stderr ?? "") !== "";
  const head = remaining.length > 0 ? [{ ...first, content: remaining }] : streamText ? [{ ...first, content: "" }] : [];
  return { text, rest: [...head, ...later] };
}

/** What the existing result renderers draw for a result: its content, or the block itself when it records none. */
export function rendererContent(result: ToolResultLike): Record<string, unknown> | string | unknown[] {
  return (result.content ?? result) as Record<string, unknown> | string | unknown[];
}

/** Metadata not consumed by the outcome/output view. Never changes the raw result. */
export function recordedResultFields(result: ToolResultLike, provider?: string): unknown {
  if (!provider || provider === "claude" || !Object.hasOwn(result, "toolUseResult")) return undefined;
  const own = result.toolUseResult;
  if (!isPlainObject(own)) return own;
  const n = normalizeResult(result, { provider, bareCodeIsExitCode: true });
  const codex = provider === "codex" || provider === "openinterpreter";
  const pi = provider === "pi" || provider === "ompi";
  const core = provider === "opencode" || provider === "kilo";
  const execution = codex || provider === "openhands";
  const remaining = (value: Record<string, unknown>, nested = false): Record<string, unknown> => Object.fromEntries(Object.entries(value).flatMap(([key, v]) => {
    const executionLevel = codex || (provider === "openhands" && nested);
    if (!nested && (((codex || core) && (key === "output" || key === "error")) || (pi && key === "content")) && JSON.stringify(v) === JSON.stringify(result.content) && v !== null) return [];
    if (!nested && key === "error_code" && v === n.errorCode) return [];
    if (executionLevel && EXIT_CODE_KEYS.includes(key as typeof EXIT_CODE_KEYS[number]) && typeof v === "number" && v === n.exitCode && !n.exitCodeConflict) return [];
    if (executionLevel && key === "interrupted" && v === true && n.interrupted === true) return [];
    if (executionLevel && (key === "stdout" || key === "stderr") && typeof v === "string" && v !== "" && v === n[key]) return [];
    if (!nested && execution && key === "metadata" && isPlainObject(v)) {
      const rest = remaining(v, true);
      return Object.keys(rest).length > 0 || Object.keys(v).length === 0 ? [[key, rest]] : [];
    }
    return [[key, v]];
  }));
  const rest = remaining(own);
  return Object.keys(rest).length > 0 || Object.keys(own).length === 0 ? rest : undefined;
}

/** Legacy execution record view: consume only facts/streams actually displayed.
 * False/null/empty and every unrelated field remain data, never completion claims.
 */
export function legacyExecutionView(record: Record<string, unknown>, provider?: string) {
  const result = { content: record };
  const normalized = normalizeResult(result, { provider });
  const outcome = toolOutcome(null, [result], "process", provider);
  const remainder = Object.fromEntries(Object.entries(record).filter(([key, value]) => {
    if ((key === "stdout" || key === "stderr") && typeof value === "string" && value !== "" && value === normalized[key]) return false;
    if (EXIT_CODE_KEYS.includes(key as typeof EXIT_CODE_KEYS[number]) && typeof value === "number" && value === outcome.exitCode && !normalized.exitCodeConflict) return false;
    if (key === "error_code" && value === outcome.errorCode) return false;
    if (key === "interrupted" && value === true && normalized.interrupted === true) return false;
    return true;
  }));
  return { stdout: normalized.stdout ?? "", stderr: normalized.stderr ?? "", outcome, remainder };
}

/** What an Agent (Task) result records about its run. */
export interface AgentStats {
  totalDurationMs?: number;
  totalTokens?: number;
  totalToolUseCount?: number;
}

/**
 * The first result's run statistics: on the block itself (as the Agent card
 * always read them), else in the block's own metadata (Claude records them
 * in the Task result's `toolUseResult`). Only numbers; nothing synthesized.
 */
export function recordedAgentStats(results: ToolResultLike[]): AgentStats {
  const first = results[0];
  if (!first) return {};
  const own = ownMetadata(first);
  const stats: AgentStats = {};
  for (const key of ["totalDurationMs", "totalTokens", "totalToolUseCount"] as const) {
    const value = typeof first[key] === "number" ? first[key] : typeof own?.[key] === "number" ? own[key] : undefined;
    if (typeof value === "number") stats[key] = value;
  }
  return stats;
}

/** What an Edit / MultiEdit result records about the edit itself. */
export interface EditFacts {
  /** The user changed the proposed edit before it was applied (`userModified`). */
  userModified?: boolean;
  /** The whole file before the edit (`originalFile`). */
  originalFile?: string;
}

/**
 * The edit facts the results' own metadata records (Claude's Edit result:
 * `userModified`, `originalFile`). The first result that records a fact
 * gives it; nothing is synthesized when none does.
 */
export function recordedEditFacts(results: ToolResultLike[]): EditFacts {
  const facts: EditFacts = {};
  for (const result of results) {
    const own = ownMetadata(result);
    if (!own) continue;
    if (facts.userModified === undefined && typeof own.userModified === "boolean") facts.userModified = own.userModified;
    if (facts.originalFile === undefined && typeof own.originalFile === "string") facts.originalFile = own.originalFile;
  }
  return facts;
}

// ---------------------------------------------------------------------------
// The verdict (plan §4.2 order: the first rule that applies wins)
// ---------------------------------------------------------------------------

export function toolOutcome(
  use: ToolUseLike | null,
  results: ToolResultLike[],
  family: ToolFamily,
  provider?: string,
): ToolOutcome {
  // An orphan (use === null) is judged by its result alone; the pairing only
  // matters for `toolRun` eligibility.
  void use;
  // 1. No result at all.
  if (results.length === 0) return { lifecycle: "no-result", verdict: "unknown", reason: "no-result-recorded" };

  const normalized = results.map((r) => normalizeResult(r, { bareCodeIsExitCode: family === "process", provider }));
  const codes = normalized.flatMap((n) => (n.exitCode === undefined ? [] : [n.exitCode]));
  const exitCode = codes.find((c) => c !== 0) ?? codes[0];
  const codesDisagree = new Set(codes).size > 1 || normalized.some((n) => n.exitCodeConflict === true);
  const withExit = (o: ToolOutcome): ToolOutcome => (exitCode === undefined ? o : { ...o, exitCode });

  const errorCode = normalized.find((n) => n.errorCode !== undefined)?.errorCode;
  const withCodes = (o: ToolOutcome): ToolOutcome => (errorCode === undefined ? withExit(o) : { ...withExit(o), errorCode });

  // 2. Interrupted. It decides the lifecycle; every other recorded fact (an
  //    exit code, an API error code) is kept beside it (review R3-F2).
  if (normalized.some((n) => n.interrupted === true)) {
    const verdict = exitCode !== undefined && exitCode !== 0 ? "failed" : "unknown";
    return withCodes({ lifecycle: "interrupted", verdict, reason: "interrupted" });
  }

  // 3. Recorded error signals; an exit code 0 beside one is a conflict.
  //    For a process tool, output text that merely starts with `error` is
  //    not a signal once an exit code is recorded: the recorded code decides
  //    (owner decision on PR #728). Explicit `is_error`/`error_code` still count.
  const providerError = normalized.some((n) => n.isError === true);
  const textOutrankedByExit = family === "process" && exitCode !== undefined;
  const errorContent = !textOutrankedByExit && normalized.some((n) => n.completed !== true && n.errorText !== undefined);
  if (providerError || errorCode !== undefined || errorContent) {
    const reason: OutcomeReason =
      exitCode === 0 || codesDisagree
        ? "conflict"
        : providerError
          ? "provider-error"
          : errorCode !== undefined
            ? "api-error-code"
            : "error-content";
    return withCodes({ lifecycle: "completed", verdict: "failed", reason });
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
  if (normalized.every((n) => n.completed === true)) return { lifecycle: "completed", verdict: "succeeded", reason: "provider-completed" };
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
