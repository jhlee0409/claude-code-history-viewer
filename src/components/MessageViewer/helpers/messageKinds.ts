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
const COMMAND_OUTPUT_PREFIXES = ["<local-command-stdout>", "<local-command-stderr>"];

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
];
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
  if (INJECTED_TEXT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "context";
  if (trimmed.startsWith("<") && trimmed.replace(INJECTED_WRAPPER_BLOCK, "").trim() === "") {
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
  if (hasToolUseResult(message)) return { kind: "tool", text: null };

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
