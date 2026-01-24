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
} from "../types";
import { getParentUuid } from "./messageHelpers";
import { getAgentIdFromProgress } from "./agentProgressHelpers";

interface FlattenOptions {
  messages: ClaudeMessage[];
  agentTaskGroups: Map<string, AgentTaskGroupResult>;
  agentTaskMemberUuids: Set<string>;
  agentProgressGroups: Map<string, AgentProgressGroupResult>;
  agentProgressMemberUuids: Set<string>;
  /** Message UUIDs to hide (only used when in capture mode) */
  hiddenMessageIds?: string[];
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

  // Build child map for efficient tree traversal
  const childrenMap = new Map<string | null, ClaudeMessage[]>();
  uniqueMessages.forEach((msg) => {
    const parentUuid = getParentUuid(msg) ?? null;
    if (!childrenMap.has(parentUuid)) {
      childrenMap.set(parentUuid, []);
    }
    childrenMap.get(parentUuid)!.push(msg);
  });

  // Get root messages (no parent)
  const rootMessages = childrenMap.get(null) ?? [];

  // If no root messages exist, treat all messages as flat list
  if (rootMessages.length === 0) {
    return flattenWithPlaceholders(
      uniqueMessages,
      hiddenSet,
      agentTaskGroups,
      agentTaskMemberUuids,
      agentProgressGroups,
      agentProgressMemberUuids
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
  // add remaining unvisited messages
  if (orderedMessages.length < uniqueMessages.length * 0.9) {
    if (import.meta.env.DEV) {
      console.warn(
        `[flattenMessageTree] Tree traversal found ${orderedMessages.length}/${uniqueMessages.length} messages. Adding orphaned messages.`
      );
    }
    for (const msg of uniqueMessages) {
      if (!visited.has(msg.uuid)) {
        orderedMessages.push(msg);
        visited.add(msg.uuid);
      }
    }
  }

  // Now flatten with placeholders
  return flattenWithPlaceholders(
    orderedMessages,
    hiddenSet,
    agentTaskGroups,
    agentTaskMemberUuids,
    agentProgressGroups,
    agentProgressMemberUuids
  );
}

/**
 * Flatten messages and insert placeholders where hidden messages were.
 */
function flattenWithPlaceholders(
  messages: ClaudeMessage[],
  hiddenSet: Set<string>,
  agentTaskGroups: Map<string, AgentTaskGroupResult>,
  agentTaskMemberUuids: Set<string>,
  agentProgressGroups: Map<string, AgentProgressGroupResult>,
  agentProgressMemberUuids: Set<string>
): FlattenedMessage[] {
  if (hiddenSet.size === 0) {
    // No hidden messages - return regular flattened list
    return messages.map((message, index) =>
      createFlattenedMessage(
        message,
        0,
        index,
        agentTaskGroups,
        agentTaskMemberUuids,
        agentProgressGroups,
        agentProgressMemberUuids
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
          agentTaskGroups,
          agentTaskMemberUuids,
          agentProgressGroups,
          agentProgressMemberUuids
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
  agentTaskGroups: Map<string, AgentTaskGroupResult>,
  agentTaskMemberUuids: Set<string>,
  agentProgressGroups: Map<string, AgentProgressGroupResult>,
  agentProgressMemberUuids: Set<string>
): FlattenedMessageItem {
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
