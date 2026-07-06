import type { ClaudeMessage, MessageCategory } from "../../../types";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";
import { groupAgentTasks } from "./agentTaskHelpers";

type CategoryCollector = (messages: ClaudeMessage[]) => Set<string>;
type ContentBlock = Record<string, unknown>;

const CODEX_COLLABORATION_TOOLS = new Set([
  "spawn_agent",
  "send_input",
  "send_message",
  "wait_agent",
  "close_agent",
]);
const CODEX_SPAWN_TOOLS = new Set(["spawn_agent"]);
const GEMINI_AGENT_TOOLS = new Set(["agent"]);
const QWEN_AGENT_TOOLS = new Set(["agent", "task"]);
const OPENCODE_AGENT_TOOLS = new Set(["Task"]);

function getContentBlocks(message: ClaudeMessage): ContentBlock[] {
  if (!Array.isArray(message.content)) return [];
  return (message.content as unknown[]).filter(
    (item): item is ContentBlock => item !== null && typeof item === "object",
  );
}

function isToolUse(block: ContentBlock, names: ReadonlySet<string>): boolean {
  return block.type === "tool_use"
    && typeof block.name === "string"
    && names.has(block.name);
}

function startsUserTurn(message: ClaudeMessage): boolean {
  if (message.provider !== "codex" || message.type !== "user") return false;
  if (typeof message.content === "string") return message.content.trim().length > 0;
  return getContentBlocks(message).some(
    (block) => block.type === "text" && typeof block.text === "string",
  );
}

function collectParallelToolCallUuids(
  messages: ClaudeMessage[],
  provider: string,
  toolNames: ReadonlySet<string>,
): Set<string> {
  const uuids = new Set<string>();
  const parallelCallIds = new Set<string>();

  for (const message of messages) {
    if (message.provider !== provider) continue;
    const toolCalls = getContentBlocks(message).filter(
      (block) => isToolUse(block, toolNames),
    );
    if (toolCalls.length < 2) continue;

    uuids.add(message.uuid);
    for (const toolCall of toolCalls) {
      if (typeof toolCall.id === "string") parallelCallIds.add(toolCall.id);
    }
  }

  for (const message of messages) {
    if (message.provider !== provider) continue;
    const hasParallelResult = getContentBlocks(message).some(
      (block) => block.type === "tool_result"
        && typeof block.tool_use_id === "string"
        && parallelCallIds.has(block.tool_use_id),
    );
    if (hasParallelResult) uuids.add(message.uuid);
  }

  return uuids;
}

/**
 * Collect messages rendered as a Parallel Tasks card by Claude-style sessions.
 *
 * Parallel Tasks can come from either a multi-agent task group or a standalone
 * <task-notification> payload. Single-agent groups are labelled Agent in the UI
 * and intentionally remain uncategorized.
 */
const collectClaudeParallelTaskUuids: CategoryCollector = (messages) => {
  const uuids = new Set<string>();

  for (const group of groupAgentTasks(messages).values()) {
    if (group.tasks.length < 2) continue;
    for (const uuid of group.messageUuids) {
      uuids.add(uuid);
    }
  }

  for (const message of messages) {
    const content = extractClaudeMessageContent(message);
    if (content?.includes("<task-notification>")) {
      uuids.add(message.uuid);
    }
  }

  return uuids;
};

/** Collect Codex collaboration messages from turns that spawn multiple agents. */
const collectCodexParallelTaskUuids: CategoryCollector = (messages) => {
  const uuids = new Set<string>();
  let turnMessages: ClaudeMessage[] = [];

  const collectTurn = () => {
    const codexMessages = turnMessages.filter((message) => message.provider === "codex");
    const spawnCount = codexMessages.reduce(
      (count, message) => count + getContentBlocks(message).filter(
        (block) => isToolUse(block, CODEX_SPAWN_TOOLS),
      ).length,
      0,
    );
    if (spawnCount < 2) return;

    const collaborationCallIds = new Set<string>();
    for (const message of codexMessages) {
      const blocks = getContentBlocks(message);
      const hasCollaborationCall = blocks.some((block) => {
        if (!isToolUse(block, CODEX_COLLABORATION_TOOLS)) return false;
        if (typeof block.id === "string") collaborationCallIds.add(block.id);
        return true;
      });
      if (hasCollaborationCall) uuids.add(message.uuid);
    }

    for (const message of codexMessages) {
      const hasCollaborationResult = getContentBlocks(message).some(
        (block) => block.type === "tool_result"
          && typeof block.tool_use_id === "string"
          && collaborationCallIds.has(block.tool_use_id),
      );
      if (hasCollaborationResult) uuids.add(message.uuid);
    }
  };

  for (const message of messages) {
    if (startsUserTurn(message) && turnMessages.length > 0) {
      collectTurn();
      turnMessages = [];
    }
    turnMessages.push(message);
  }
  collectTurn();

  return uuids;
};

/** Collect Gemini messages containing multiple recorded subagent invocations. */
const collectGeminiParallelTaskUuids: CategoryCollector = (messages) => {
  const uuids = new Set<string>();

  for (const message of messages) {
    if (message.provider !== "gemini") continue;
    const subagentCalls = getContentBlocks(message).filter(
      (block) => block.type === "tool_use"
        && (
          (typeof block.agentId === "string" && block.agentId.length > 0)
          || isToolUse(block, GEMINI_AGENT_TOOLS)
        ),
    );
    if (subagentCalls.length >= 2) uuids.add(message.uuid);
  }

  return uuids;
};

const collectQwenParallelTaskUuids: CategoryCollector = (messages) =>
  collectParallelToolCallUuids(messages, "qwen", QWEN_AGENT_TOOLS);

const collectOpenCodeParallelTaskUuids: CategoryCollector = (messages) =>
  collectParallelToolCallUuids(messages, "opencode", OPENCODE_AGENT_TOOLS);

const collectParallelTaskUuids: CategoryCollector = (messages) => {
  const uuids = collectClaudeParallelTaskUuids(messages);
  for (const uuid of collectCodexParallelTaskUuids(messages)) uuids.add(uuid);
  for (const uuid of collectGeminiParallelTaskUuids(messages)) uuids.add(uuid);
  for (const uuid of collectQwenParallelTaskUuids(messages)) uuids.add(uuid);
  for (const uuid of collectOpenCodeParallelTaskUuids(messages)) uuids.add(uuid);
  return uuids;
};

const CATEGORY_COLLECTORS: Record<MessageCategory, CategoryCollector> = {
  "parallel-task": collectParallelTaskUuids,
};

/** Return the message UUIDs belonging to a provider-neutral category. */
export function getMessageUuidsByCategory(
  messages: ClaudeMessage[],
  category: MessageCategory,
): Set<string> {
  if (messages.length === 0) return new Set();
  return CATEGORY_COLLECTORS[category](messages);
}

/** Include or exclude one provider-neutral message category. */
export function filterMessagesByCategory(
  messages: ClaudeMessage[],
  category: MessageCategory,
  include: boolean,
): ClaudeMessage[] {
  if (include || messages.length === 0) return messages;

  const categorizedUuids = getMessageUuidsByCategory(messages, category);
  if (categorizedUuids.size === 0) return messages;
  return messages.filter((message) => !categorizedUuids.has(message.uuid));
}
