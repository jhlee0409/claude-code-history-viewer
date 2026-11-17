import type { ClaudeMessage } from "../../../types";

/**
 * What a transcript row is from the reader's point of view.
 *
 * `message.type` alone cannot tell these apart: Claude Code stores slash
 * commands, background-task notifications, and client-injected context as
 * `type: "user"`, so a role-based view shows them all as typed prompts.
 */
export type MessageKind =
  /** Text the user typed (or pasted, or an image they attached). */
  | "prompt"
  /** A slash command, or the local output of one. */
  | "command"
  /** A `<task-notification>` from a background agent or command. */
  | "agent-update"
  /** Text the client injected into the user turn, not typed by the user. */
  | "context"
  /**
   * The user's answer to a question the assistant asked through a user-input
   * tool (Claude Code's `AskUserQuestion`). The answer is the user's input,
   * but it answers a question instead of starting a turn.
   */
  | "answer"
  /** Assistant text. */
  | "reply"
  /** A tool call or tool result that carries no text. */
  | "tool"
  | "system"
  | "summary";

export interface TaskNotification {
  taskId?: string;
  status?: string;
  summary?: string;
  result?: string;
}

export interface MessageKindInfo {
  kind: MessageKind;
  /** The text block that decided the kind, or null when the row has no text. */
  text: string | null;
  /** Present when `kind` is "agent-update". */
  notification?: TaskNotification;
}

const TASK_NOTIFICATION_BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g;
// Claude Code 2.1.285 bash-mode emits a separate generated user message:
// ke({content:`<bash-stdout>${C}</bash-stdout><bash-stderr>…`}).
// Binary evidence and scope: docs/contracts/transcript-items.md, producer grounding.
// Local slash-command output keeps its existing prefix policy; bash-mode output
// must consume the whole text block, never swallow typed text after a wrapper.
const COMMAND_OUTPUT_PREFIXES = ["<local-command-stdout>", "<local-command-stderr>"];
const BASH_OUTPUT_BLOCK = /<(bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g;

/**
 * Wrapper tags that Claude Code and Codex inject into the user turn. This is
 * an allowlist on purpose: a false "context" would hide a real prompt from
 * the prompts-only view, which is the bug this module exists to fix.
 */
const INJECTED_WRAPPER_TAGS = [
  "local-command-caveat",
  "system-reminder",
  "environment_context",
  "user_instructions",
  // Codex 0.164.0 ContextualUserFragment markers (not typed input):
  // https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/context/recommended_plugins_instructions.rs#L31-L46
  // https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/context/turn_aborted.rs#L22-L37
  "recommended_plugins",
  "turn_aborted",
  // Historical emitted wrapper, not merely current-reader compatibility:
  // https://github.com/openai/codex/blob/522f549922f6e7b8edbd5e9be3fc720ddb9b256a/codex-rs/core/src/context/goal_context.rs#L20-L36
  // https://github.com/openai/codex/blob/522f549922f6e7b8edbd5e9be3fc720ddb9b256a/codex-rs/core/src/goals.rs#L1599-L1601
  "goal_context",
];
// Internal context has a producer-validated source attribute, not a bare tag.
// https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/context/internal_model_context.rs#L64-L136
// user_goal emission: same revision, context/user_goal.rs#L63-L90.
const INTERNAL_CONTEXT_BLOCK = /<codex_internal_context source="[a-z][a-z0-9_]*">[\s\S]*?<\/codex_internal_context>/g;
const INJECTED_WRAPPER_BLOCK = new RegExp(
  `<(${INJECTED_WRAPPER_TAGS.join("|")})>[\\s\\S]*?<\\/\\1>`,
  "g",
);
const INJECTED_TEXT_PREFIXES = [
  "[Request interrupted by user",
  // Claude Code's compaction summary. The backend drops the transcript's
  // `isCompactSummary` flag, so the opening sentence is the only signal.
  "This session is being continued from a previous conversation",
];

function readTag(text: string, tagName: string): string | undefined {
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match?.[1]?.trim();
}

// Terminal task states that did not succeed. "killed" and "stopped" both mean
// the task ended before completing (Claude Code writes "stopped" when a
// background command did not finish before the session ended).
const FAILED_TASK_STATUSES = new Set(["failed", "error", "killed", "stopped"]);

/** True when a task-notification status means the task ended without succeeding. */
export function isFailedTaskStatus(status: string | undefined): boolean {
  return status != null && FAILED_TASK_STATUSES.has(status);
}

/** True when the text holds at least one complete `<task-notification>` block. */
export function isTaskNotification(text: string): boolean {
  return /<task-notification>[\s\S]*?<\/task-notification>/.test(text);
}

/** Parse every `<task-notification>` block in the text, in order. */
export function parseTaskNotifications(text: string): TaskNotification[] {
  return [...text.matchAll(TASK_NOTIFICATION_BLOCK)].map((match) => {
    const body = match[1] ?? "";
    return {
      taskId: readTag(body, "task-id"),
      status: readTag(body, "status"),
      summary: readTag(body, "summary"),
      result: readTag(body, "result"),
    };
  });
}

/** Parse the first `<task-notification>` block, or return null if there is none. */
export function parseTaskNotification(
  text: string,
): Omit<TaskNotification, "result"> | null {
  const first = parseTaskNotifications(text)[0];
  if (!first) return null;
  return { taskId: first.taskId, status: first.status, summary: first.summary };
}

function getTextBlocks(message: ClaudeMessage): string[] {
  const { content } = message;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content as unknown[]) {
    if (block === null || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") texts.push(typed.text);
  }
  return texts;
}

/** Client wake fallback: exact scheduler grammar, not proof of host provenance.
 * Delivered source cardinality/types and host kinds are authoritative when present.
 * Unmarked inputs use owner-approved viewer decision B: exact grammar plus
 * embedded/record time within ±5s (local 34 envelopes: max 2.9s). This is NOT
 * the Codex origin rule; see docs/contracts/codex-frontend-turns-diffs.md. Reader:
 * https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/history/src/heartbeat.rs#L62-L110
 * L69: one InputText; L78–82: UTF-8 byte/line budget; L87–101: exact fields.
 * Instructions are opaque: split_once/strip_suffix do not reject inner tags.
 * https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/history/src/heartbeat_tests.rs#L23-L28
 */
export function isCodexHeartbeat(message: ClaudeMessage): boolean {
  if (message.type !== "user" || message.provider !== "codex") return false;
  const evidence = message.codexEvidence;
  if (evidence && Object.hasOwn(evidence, "contentItems")) {
    const items = evidence.contentItems;
    if (!Array.isArray(items) || items.length !== 1 || items[0]?.type !== "input_text") return false;
  }
  const kinds = evidence?.contentItemKinds;
  const hostMarked = Array.isArray(kinds) && kinds.length === 1 && kinds[0] === "user.heartbeat";
  // Absent kinds and exactly the default user.text are the only legacy shapes.
  if (!hostMarked && evidence && Object.hasOwn(evidence, "contentItemKinds")
    && !(Array.isArray(kinds) && kinds.length === 1 && kinds[0] === "user.text")) return false;
  const content = message.content;
  const text = typeof content === "string" ? content
    : Array.isArray(content) && content.length === 1 && content[0]?.type === "text"
      && typeof content[0].text === "string" ? content[0].text : null;
  if (text === null) return false;
  // Rust str::lines excludes the final empty segment, but counts blank lines.
  const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (new TextEncoder().encode(text).length + lines * 6 + 64 > 3600) return false;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const prefix = "<heartbeat>\n  <automation_id>";
  const timeSeparator = "</automation_id>\n  <current_time_iso>";
  const instructionSeparator = "</current_time_iso>\n  <instructions>\n";
  const suffix = "\n  </instructions>\n</heartbeat>";
  if (!body.startsWith(prefix)) return false;
  const timeIndex = body.indexOf(timeSeparator, prefix.length);
  if (timeIndex === -1) return false;
  const automationId = body.slice(prefix.length, timeIndex);
  const timeStart = timeIndex + timeSeparator.length;
  const instructionIndex = body.indexOf(instructionSeparator, timeStart);
  if (instructionIndex === -1) return false;
  const timestamp = body.slice(timeStart, instructionIndex);
  const instructions = body.slice(instructionIndex + instructionSeparator.length);
  return /^[A-Za-z0-9_-]{1,128}$/.test(automationId)
    && /^[0-9TZ:.+-]{1,64}$/.test(timestamp)
    && instructions.endsWith(suffix)
    // Host-marked input retains the exact reader grammar (even its ASCII-only
    // timestamp check); only the viewer fallback requires real, correlated time.
    && (hostMarked || isCorrelatedInstant(timestamp, message.timestamp));
}

/**
 * Strict ISO-8601 instant with an explicit zone. Rejects impossible calendar or
 * clock values that `Date.parse` may silently normalize (e.g. 2026-02-30).
 */
function parseZonedInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone, sign, zh, zm] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  if (day < 1 || day > utcDaysInMonth(year, month)) return null;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const oh = Number(zh), om = Number(zm);
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (sign === "-" ? -1 : 1) * (oh * 60 + om);
  }
  const millis = frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, "0"));
  // setUTCFullYear keeps years 0-99 literal (Date.UTC would remap them to 19xx).
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millis);
  return date.getTime() - offsetMinutes * 60_000;
}

function utcDaysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

/** Owner-approved viewer rule: both instants valid, zoned, and within ±5s. */
function isCorrelatedInstant(embedded: string, recorded: unknown): boolean {
  const a = parseZonedInstant(embedded);
  const b = parseZonedInstant(recorded);
  return a !== null && b !== null && Math.abs(a - b) <= 5_000;
}

/** True when the record carries the client's own tool-result payload. */
function hasToolUseResult(message: ClaudeMessage): boolean {
  return "toolUseResult" in message && message.toolUseResult != null;
}

function hasToolResult(message: ClaudeMessage): boolean {
  if (hasToolUseResult(message)) return true;
  if (!Array.isArray(message.content)) return false;
  return (message.content as unknown[]).some(
    (block) => block !== null
      && typeof block === "object"
      && (block as { type?: unknown }).type === "tool_result",
  );
}

function hasToolUse(message: ClaudeMessage): boolean {
  if ("toolUse" in message && message.toolUse) return true;
  if (!Array.isArray(message.content)) return false;
  return (message.content as unknown[]).some(
    (block) => block !== null
      && typeof block === "object"
      && (block as { type?: unknown }).type === "tool_use",
  );
}

/**
 * Tools that stop the agent to ask the user, so their result is the user's
 * input. Only names the renderers already model (toolKind "question"); a name
 * is never guessed from a substring.
 */
const USER_INPUT_TOOL_NAMES: Readonly<Record<string, true>> = { AskUserQuestion: true };

type ContentBlock = Record<string, unknown>;

function isContentBlock(value: unknown): value is ContentBlock {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function contentBlocks(message: ClaudeMessage): ContentBlock[] {
  return Array.isArray(message.content) ? (message.content as unknown[]).filter(isContentBlock) : [];
}

/**
 * The answers in an AskUserQuestion result payload,
 * `{ questions: [...], answers: { [question]: answer } }`: a picked option's
 * label, or the text the user typed instead. Null when the payload has
 * another shape.
 */
function recordedAnswers(raw: unknown): string[] | null {
  if (!isContentBlock(raw) || !Array.isArray(raw.questions) || !isContentBlock(raw.answers)) return null;
  return Object.values(raw.answers).filter(
    (answer): answer is string => typeof answer === "string" && answer.trim() !== "",
  );
}

function toolResultText(block: ContentBlock | undefined): string | null {
  const content = block?.content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = (content as unknown[])
    .map((item) => (isContentBlock(item) && item.type === "text" ? item.text : undefined))
    .filter((item): item is string => typeof item === "string")
    .join("\n")
    .trim();
  return text || null;
}

/** The recorded answers, else the result's own text. */
function answerInfo(raw: unknown, result: ContentBlock | undefined): MessageKindInfo {
  const answers = recordedAnswers(raw);
  const text = answers && answers.length > 0 ? answers.join(" · ") : toolResultText(result);
  return { kind: "answer", text };
}

/**
 * The answer an assistant row carries: a user-input tool call whose result
 * the backend merged into it (merge_tool_execution_messages). An unanswered
 * call, or one whose result is an error (declined, interrupted), is the
 * question alone and stays a tool row.
 */
function assistantAnswer(message: ClaudeMessage): MessageKindInfo | null {
  const blocks = contentBlocks(message);
  const questionIds = new Set<unknown>();
  for (const block of blocks) {
    if (block.type === "tool_use" && typeof block.name === "string" && Object.hasOwn(USER_INPUT_TOOL_NAMES, block.name)) {
      questionIds.add(block.id);
    }
  }
  if (questionIds.size === 0) return null;
  const result = blocks.find(
    (block) => block.type === "tool_result" && questionIds.has(block.tool_use_id) && block.is_error !== true,
  );
  return result ? answerInfo(result.toolUseResult, result) : null;
}

/**
 * The answer a user row carries: a result record whose call is on a page
 * that has not loaded, so it was not merged. The call's name is not on the
 * record, so the payload's shape identifies it. A record whose result block
 * was merged away keeps `toolUseResult` too; the block is required so the
 * answer is never counted twice.
 */
function unmergedAnswer(message: ClaudeMessage): MessageKindInfo | null {
  const raw = "toolUseResult" in message ? message.toolUseResult : undefined;
  if (!recordedAnswers(raw)) return null;
  const result = contentBlocks(message).find((block) => block.type === "tool_result");
  if (!result || result.is_error === true) return null;
  return answerInfo(raw, result);
}

/**
 * True when the row carries the user's answer to a user-input tool: the
 * "answer" kind `classifyMessage` returns, without classifying the row's text.
 */
export function isUserAnswer(message: ClaudeMessage): boolean {
  if (message.type === "assistant") return assistantAnswer(message) !== null;
  return message.type === "user" && unmergedAnswer(message) !== null;
}

/**
 * How many `tool_use` blocks a message carries. `content` is counted first:
 * when the raw record has no top-level `toolUse`, the backend (load.rs) fills
 * it from the FIRST content block only, so a set `toolUse` does not mean one
 * call. `toolUse` counts as one call only when there is no content array.
 */
export function countToolUseBlocks(message: ClaudeMessage): number {
  if (Array.isArray(message.content)) {
    const blocks = (message.content as unknown[]).filter(
      (block) => block !== null
        && typeof block === "object"
        && (block as { type?: unknown }).type === "tool_use",
    ).length;
    if (blocks > 0) return blocks;
  }
  return "toolUse" in message && message.toolUse ? 1 : 0;
}

type UserBlockKind = "prompt" | "command" | "agent-update" | "context";

function classifyUserText(text: string): UserBlockKind {
  const trimmed = text.trim();
  if (isTaskNotification(trimmed)) return "agent-update";
  if (trimmed.startsWith("<") && trimmed.includes("<command-name>")) return "command";
  if (COMMAND_OUTPUT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "command";
  if (/^<bash-(stdout|stderr)>/.test(trimmed) && trimmed.replace(BASH_OUTPUT_BLOCK, "").trim() === "") return "command";
  if (INJECTED_TEXT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "context";
  if (trimmed.startsWith("<") && trimmed.replace(INTERNAL_CONTEXT_BLOCK, "").replace(INJECTED_WRAPPER_BLOCK, "").trim() === "") {
    return "context";
  }
  return "prompt";
}

// When one message holds several text blocks, anything the user typed wins,
// then an agent update, then a command, and injected context comes last.
const USER_BLOCK_PRECEDENCE: UserBlockKind[] = ["prompt", "agent-update", "command", "context"];

function classifyUserMessage(message: ClaudeMessage): MessageKindInfo {
  // Only the client writes a tool-result record, so text on one was appended
  // by the client (ToolSearch adds "Tool loaded."), not typed. This keys on
  // `toolUseResult` rather than a tool_result block: the backend moves the
  // block into its call, and a fork's task directive sits beside an unmerged
  // block without the field.
  // An AskUserQuestion result whose call is not loaded is still the user's answer.
  if (hasToolUseResult(message)) return unmergedAnswer(message) ?? { kind: "tool", text: null };
  // Keep automated Codex wake input out of the existing human-prompt filters.
  // Its separate automated turn kind belongs to the pure model, not this UI kind.
  if (isCodexHeartbeat(message)) return { kind: "context", text: getTextBlocks(message)[0] ?? null };

  const blocks = getTextBlocks(message)
    .filter((text) => text.trim().length > 0)
    .map((text) => ({ text, kind: classifyUserText(text) }));

  if (blocks.length === 0) {
    // A tool result whose tool call is on a page that has not loaded yet
    // arrives on its own instead of being merged into the call.
    return { kind: hasToolResult(message) ? "tool" : "prompt", text: null };
  }

  for (const kind of USER_BLOCK_PRECEDENCE) {
    const block = blocks.find((candidate) => candidate.kind === kind);
    if (!block) continue;
    if (kind === "agent-update") {
      return {
        kind,
        text: block.text,
        notification: parseTaskNotification(block.text) ?? undefined,
      };
    }
    return { kind, text: block.text };
  }
  return { kind: "prompt", text: blocks[0]?.text ?? null };
}

/** Classify a message and return the text block that decided its kind. */
export function classifyMessage(message: ClaudeMessage): MessageKindInfo {
  switch (message.type) {
    case "user":
      return classifyUserMessage(message);
    case "assistant": {
      // The user's answer outranks assistant text on the same row, as typed
      // text outranks injected text on a user row: it is the user's input.
      const answer = assistantAnswer(message);
      if (answer) return answer;
      const text = getTextBlocks(message).find((block) => block.trim().length > 0) ?? null;
      if (text) return { kind: "reply", text };
      return { kind: hasToolUse(message) ? "tool" : "reply", text: null };
    }
    case "summary":
      return { kind: "summary", text: message.summary ?? getTextBlocks(message)[0] ?? null };
    default:
      return { kind: "system", text: getTextBlocks(message)[0] ?? null };
  }
}

export function getMessageKind(message: ClaudeMessage): MessageKind {
  return classifyMessage(message).kind;
}

/**
 * True when the row begins a turn: text the user typed, or a slash-command
 * invocation. A local command's output is a command row too, but it follows
 * its invocation instead of starting a turn of its own.
 */
export function isTurnStart(info: MessageKindInfo): boolean {
  if (info.kind === "prompt") return true;
  return info.kind === "command" && info.text != null && info.text.includes("<command-name>");
}
