/**
 * Flatten Message Tree Helper
 *
 * Transforms hierarchical message tree structure into a flat array
 * with depth information preserved for virtual scrolling.
 */

import type { ClaudeMessage } from "../../../types";
import type {
  FlattenedMessage,
  FlattenedMessageItem,
  HiddenBlocksPlaceholder,
  AgentProgressGroup,
  AgentTaskGroupResult,
  AgentProgressGroupResult,
  TaskOperationGroupResult,
} from "../types";

interface GroupContext {
  agentTaskGroups: Map<string, AgentTaskGroupResult>;
  agentTaskMemberUuids: Set<string>;
  agentProgressGroups: Map<string, AgentProgressGroupResult>;
  agentProgressMemberUuids: Set<string>;
  taskOperationGroups: Map<string, TaskOperationGroupResult>;
  taskOperationMemberUuids: Set<string>;
}
import { getParentUuid } from "./messageHelpers";
import { getAgentIdFromProgress } from "./agentProgressHelpers";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";

interface FlattenOptions {
  messages: ClaudeMessage[];
  agentTaskGroups: Map<string, AgentTaskGroupResult>;
  agentTaskMemberUuids: Set<string>;
  agentProgressGroups: Map<string, AgentProgressGroupResult>;
  agentProgressMemberUuids: Set<string>;
  taskOperationGroups: Map<string, TaskOperationGroupResult>;
  taskOperationMemberUuids: Set<string>;
  /** Message UUIDs to hide (only used when in capture mode) */
  hiddenMessageIds?: string[];
}

/**
 * Merges command output messages into their parent command messages.
 *
 * When a user runs a slash command like `/cost`, two messages appear:
 * 1. A "System" message with <command-name>/cost</command-name>
 * 2. A "User" message with <local-command-stdout>result</local-command-stdout>
 *
 * This function merges the stdout content into the parent command message
 * so they render as a single card.
 */
function mergeCommandOutputMessages(messages: ClaudeMessage[]): ClaudeMessage[] {
  // Build uuid lookup
  const uuidMap = new Map<string, ClaudeMessage>();
  for (const msg of messages) {
    uuidMap.set(msg.uuid, msg);
  }

  // Find stdout-only children of command messages
  const mergedUuids = new Set<string>();

  for (const msg of messages) {
    const content = extractClaudeMessageContent(msg);
    if (!content || typeof content !== "string") continue;

    // Check if this message is ONLY local-command-stdout (+ optional caveat/whitespace)
    const stripped = content
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
      .trim();
    if (stripped.length > 0) continue;

    // Must have actual stdout content
    if (!/<local-command-stdout>\s*\S/.test(content)) continue;

    // Find parent
    const parentUuid = getParentUuid(msg);
    if (!parentUuid) continue;
    const parent = uuidMap.get(parentUuid);
    if (!parent) continue;

    // Parent must be a command message
    const parentContent = extractClaudeMessageContent(parent);
    if (!parentContent || typeof parentContent !== "string") continue;
    if (!/<command-name>/.test(parentContent)) continue;

    // Merge: always set content as combined string via extractClaudeMessageContent results
    // This avoids type ambiguity with the underlying content field
    const mergedContent = parentContent + "\n" + content;
    const updatedParent: ClaudeMessage = { ...parent, content: mergedContent };

    uuidMap.set(parentUuid, updatedParent);
    mergedUuids.add(msg.uuid);
  }

  if (mergedUuids.size === 0) {
    return messages;
  }

  return messages
    .filter(msg => !mergedUuids.has(msg.uuid))
    .map(msg => uuidMap.get(msg.uuid) || msg);
}

/**
 * Flatten message tree using DFS traversal while preserving depth.
 * Also attaches group information for agent tasks and progress.
 * When messages are hidden, inserts placeholder items showing the count.
 */
export function flattenMessageTree({
  messages,
  agentTaskGroups,
  agentTaskMemberUuids,
  agentProgressGroups,
  agentProgressMemberUuids,
  taskOperationGroups,
  taskOperationMemberUuids,
  hiddenMessageIds = [],
}: FlattenOptions): FlattenedMessage[] {
  // Create a Set for O(1) lookup of hidden messages
  const hiddenSet = new Set(hiddenMessageIds);
  if (messages.length === 0) {
    return [];
  }

  // Deduplicate messages
  const uniqueMessages = Array.from(
    new Map(messages.map((msg) => [msg.uuid, msg])).values()
  );

  // Merge command + stdout pairs
  const processedMessages = mergeCommandOutputMessages(uniqueMessages);

  // Build child map for efficient tree traversal
  const childrenMap = new Map<string | null, ClaudeMessage[]>();
  processedMessages.forEach((msg) => {
    const parentUuid = getParentUuid(msg) ?? null;
    if (!childrenMap.has(parentUuid)) {
      childrenMap.set(parentUuid, []);
    }
    childrenMap.get(parentUuid)!.push(msg);
  });

  // Sort children by timestamp for each parent to ensure chronological order
  const sortByTimestamp = (a: ClaudeMessage, b: ClaudeMessage): number => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeA - timeB;
  };

  for (const children of childrenMap.values()) {
    children.sort(sortByTimestamp);
  }

  // Get root messages (no parent) - already sorted by timestamp
  const rootMessages = childrenMap.get(null) ?? [];

  // Build group context
  const groups: GroupContext = {
    agentTaskGroups,
    agentTaskMemberUuids,
    agentProgressGroups,
    agentProgressMemberUuids,
    taskOperationGroups,
    taskOperationMemberUuids,
  };

  // If no root messages exist, treat all messages as flat list
  if (rootMessages.length === 0) {
    return flattenWithPlaceholders(
      processedMessages,
      hiddenSet,
      groups
    );
  }

  // DFS traversal to flatten tree - first collect all messages in order
  const orderedMessages: ClaudeMessage[] = [];
  const visited = new Set<string>();

  function traverse(message: ClaudeMessage, skipDueToHiddenParent = false): void {
    if (visited.has(message.uuid)) {
      if (import.meta.env.DEV) {
        console.warn(`Circular reference detected for message: ${message.uuid}`);
      }
      return;
    }

    visited.add(message.uuid);

    // Track if this message should be skipped due to hidden parent
    const isHiddenByParent = skipDueToHiddenParent;

    // Add message to ordered list (we'll filter later)
    if (!isHiddenByParent) {
      orderedMessages.push(message);
    }

    // Traverse children (skip children if this message is hidden)
    const isHidden = hiddenSet.has(message.uuid) || isHiddenByParent;
    const children = childrenMap.get(message.uuid) ?? [];
    for (const child of children) {
      traverse(child, isHidden);
    }
  }

  // Start from root messages
  for (const root of rootMessages) {
    traverse(root);
  }

  // Fallback: If tree traversal resulted in significantly fewer messages,
  // add remaining unvisited messages (sorted by timestamp)
  if (orderedMessages.length < processedMessages.length * 0.9) {
    if (import.meta.env.DEV) {
      console.warn(
        `[flattenMessageTree] Tree traversal found ${orderedMessages.length}/${processedMessages.length} messages. Adding orphaned messages.`
      );
    }
    // Collect and sort orphaned messages by timestamp
    const orphanedMessages = processedMessages
      .filter((msg) => !visited.has(msg.uuid))
      .sort(sortByTimestamp);

    for (const msg of orphanedMessages) {
      orderedMessages.push(msg);
      visited.add(msg.uuid);
    }
  }

  // Now flatten with placeholders
  return flattenWithPlaceholders(
    orderedMessages,
    hiddenSet,
    groups
  );
}

/**
 * Flatten messages and insert placeholders where hidden messages were.
 */
function flattenWithPlaceholders(
  messages: ClaudeMessage[],
  hiddenSet: Set<string>,
  groups: GroupContext
): FlattenedMessage[] {
  if (hiddenSet.size === 0) {
    // No hidden messages - return regular flattened list
    return messages.map((message, index) =>
      createFlattenedMessage(
        message,
        0,
        index,
        groups
      )
    );
  }

  const result: FlattenedMessage[] = [];
  let pendingHiddenUuids: string[] = [];
  let visibleMessageIndex = 0;

  for (const message of messages) {
    if (hiddenSet.has(message.uuid)) {
      // Accumulate hidden message UUIDs
      pendingHiddenUuids.push(message.uuid);
    } else {
      // Flush pending hidden messages as placeholder
      if (pendingHiddenUuids.length > 0) {
        const placeholder: HiddenBlocksPlaceholder = {
          type: "hidden-placeholder",
          hiddenCount: pendingHiddenUuids.length,
          hiddenUuids: [...pendingHiddenUuids],
        };
        result.push(placeholder);
        pendingHiddenUuids = [];
      }

      // Add visible message with correct originalIndex
      result.push(
        createFlattenedMessage(
          message,
          0,
          visibleMessageIndex,
          groups
        )
      );
      visibleMessageIndex++;
    }
  }

  // Flush any remaining hidden messages at the end
  if (pendingHiddenUuids.length > 0) {
    const placeholder: HiddenBlocksPlaceholder = {
      type: "hidden-placeholder",
      hiddenCount: pendingHiddenUuids.length,
      hiddenUuids: [...pendingHiddenUuids],
    };
    result.push(placeholder);
  }

  return result;
}

/**
 * Create a FlattenedMessageItem object with group information.
 */
function createFlattenedMessage(
  message: ClaudeMessage,
  depth: number,
  originalIndex: number,
  groups: GroupContext
): FlattenedMessageItem {
  const { agentTaskGroups, agentTaskMemberUuids, agentProgressGroups, agentProgressMemberUuids, taskOperationGroups, taskOperationMemberUuids } = groups;

  // Check agent task group status
  const taskGroupInfo = agentTaskGroups.get(message.uuid);
  const isGroupLeader = !!taskGroupInfo;
  const isGroupMember = !isGroupLeader && agentTaskMemberUuids.has(message.uuid);

  // Check agent progress group status
  const progressGroupInfo = agentProgressGroups.get(message.uuid);
  const isProgressGroupLeader = !!progressGroupInfo;
  const isProgressGroupMember =
    !isProgressGroupLeader && agentProgressMemberUuids.has(message.uuid);

  // Build agent progress group data if leader
  let agentProgressGroup: AgentProgressGroup | undefined;
  if (isProgressGroupLeader) {
    const agentId = getAgentIdFromProgress(message);
    if (agentId) {
      agentProgressGroup = {
        entries: progressGroupInfo!.entries,
        agentId,
      };
    }
  }

  // Check task operation group status
  const taskOpGroupInfo = taskOperationGroups.get(message.uuid);
  const isTaskOperationGroupLeader = !!taskOpGroupInfo;
  const isTaskOperationGroupMember =
    !isTaskOperationGroupLeader && taskOperationMemberUuids.has(message.uuid);

  return {
    type: "message",
    message,
    depth,
    originalIndex,
    isGroupLeader,
    isGroupMember,
    isProgressGroupLeader,
    isProgressGroupMember,
    agentTaskGroup: isGroupLeader ? taskGroupInfo!.tasks : undefined,
    agentProgressGroup,
    isTaskOperationGroupLeader,
    isTaskOperationGroupMember,
    taskOperationGroup: isTaskOperationGroupLeader ? taskOpGroupInfo!.operations : undefined,
    taskRegistry: isTaskOperationGroupLeader ? taskOpGroupInfo!.taskRegistry : undefined,
  };
}

/**
 * Build a UUID to index map for quick lookups.
 * Only includes message items, not placeholders.
 */
export function buildUuidToIndexMap(
  flattenedMessages: FlattenedMessage[]
): Map<string, number> {
  const map = new Map<string, number>();
  flattenedMessages.forEach((item, index) => {
    // Only map message items, skip placeholders
    if (item.type === "message") {
      map.set(item.message.uuid, index);
    }
  });
  return map;
}

/**
 * Find the index of a group leader for a given member UUID.
 * Used when navigating to a group member (should scroll to leader instead).
 */
export function findGroupLeaderIndex(
  uuid: string,
  flattenedMessages: FlattenedMessage[],
  agentTaskGroups: Map<string, AgentTaskGroupResult>,
  agentProgressGroups: Map<string, AgentProgressGroupResult>
): number | null {
  // Check if this UUID belongs to an agent task group
  for (const [leaderId, group] of agentTaskGroups.entries()) {
    if (group.messageUuids.has(uuid)) {
      const leaderIndex = flattenedMessages.findIndex(
        (item) => item.type === "message" && item.message.uuid === leaderId
      );
      return leaderIndex >= 0 ? leaderIndex : null;
    }
  }

  // Check if this UUID belongs to an agent progress group
  for (const [leaderId, group] of agentProgressGroups.entries()) {
    if (group.messageUuids.has(uuid)) {
      const leaderIndex = flattenedMessages.findIndex(
        (item) => item.type === "message" && item.message.uuid === leaderId
      );
      return leaderIndex >= 0 ? leaderIndex : null;
    }
  }

  return null;
}
