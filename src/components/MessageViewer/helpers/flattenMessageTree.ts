/**
 * Flatten Message Tree Helper
 *
 * Transforms hierarchical message tree structure into a flat array
 * with depth information preserved for virtual scrolling.
 */

import type { ClaudeMessage } from "../../../types";
import type {
  FlattenedMessage,
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
}

/**
 * Flatten message tree using DFS traversal while preserving depth.
 * Also attaches group information for agent tasks and progress.
 */
export function flattenMessageTree({
  messages,
  agentTaskGroups,
  agentTaskMemberUuids,
  agentProgressGroups,
  agentProgressMemberUuids,
}: FlattenOptions): FlattenedMessage[] {
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
    return uniqueMessages.map((message, index) =>
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

  // DFS traversal to flatten tree
  const result: FlattenedMessage[] = [];
  const visited = new Set<string>();

  function traverse(message: ClaudeMessage, depth: number): void {
    if (visited.has(message.uuid)) {
      console.warn(`Circular reference detected for message: ${message.uuid}`);
      return;
    }

    visited.add(message.uuid);

    result.push(
      createFlattenedMessage(
        message,
        depth,
        result.length,
        agentTaskGroups,
        agentTaskMemberUuids,
        agentProgressGroups,
        agentProgressMemberUuids
      )
    );

    // Traverse children
    const children = childrenMap.get(message.uuid) ?? [];
    for (const child of children) {
      traverse(child, depth + 1);
    }
  }

  // Start from root messages
  for (const root of rootMessages) {
    traverse(root, 0);
  }

  // Fallback: If tree traversal resulted in significantly fewer messages,
  // some messages might be orphaned (parent UUID points to non-existent message).
  // In this case, add remaining unvisited messages at depth 0.
  if (result.length < uniqueMessages.length * 0.9) {
    console.warn(
      `[flattenMessageTree] Tree traversal found ${result.length}/${uniqueMessages.length} messages. Adding orphaned messages.`
    );
    for (const msg of uniqueMessages) {
      if (!visited.has(msg.uuid)) {
        result.push(
          createFlattenedMessage(
            msg,
            0,
            result.length,
            agentTaskGroups,
            agentTaskMemberUuids,
            agentProgressGroups,
            agentProgressMemberUuids
          )
        );
        visited.add(msg.uuid);
      }
    }
  }

  return result;
}

/**
 * Create a FlattenedMessage object with group information.
 */
function createFlattenedMessage(
  message: ClaudeMessage,
  depth: number,
  originalIndex: number,
  agentTaskGroups: Map<string, AgentTaskGroupResult>,
  agentTaskMemberUuids: Set<string>,
  agentProgressGroups: Map<string, AgentProgressGroupResult>,
  agentProgressMemberUuids: Set<string>
): FlattenedMessage {
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
 */
export function buildUuidToIndexMap(
  flattenedMessages: FlattenedMessage[]
): Map<string, number> {
  const map = new Map<string, number>();
  flattenedMessages.forEach((item, index) => {
    map.set(item.message.uuid, index);
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
        (item) => item.message.uuid === leaderId
      );
      return leaderIndex >= 0 ? leaderIndex : null;
    }
  }

  // Check if this UUID belongs to an agent progress group
  for (const [leaderId, group] of agentProgressGroups.entries()) {
    if (group.messageUuids.has(uuid)) {
      const leaderIndex = flattenedMessages.findIndex(
        (item) => item.message.uuid === leaderId
      );
      return leaderIndex >= 0 ? leaderIndex : null;
    }
  }

  return null;
}
