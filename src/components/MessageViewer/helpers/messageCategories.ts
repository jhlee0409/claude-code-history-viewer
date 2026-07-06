import type { ClaudeMessage, MessageCategory } from "../../../types";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";
import { groupAgentTasks } from "./agentTaskHelpers";

type CategoryCollector = (messages: ClaudeMessage[]) => Set<string>;

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

const CATEGORY_COLLECTORS: Record<MessageCategory, CategoryCollector> = {
  "parallel-task": collectClaudeParallelTaskUuids,
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
