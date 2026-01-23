/**
 * Agent Progress Helpers
 *
 * Functions for grouping and processing agent progress messages.
 */

import type { ClaudeMessage, ProgressData } from "../../../types";
import type { AgentProgressEntry, AgentProgressGroupResult } from "../types";

/**
 * Check if a message is an agent progress message
 */
export const isAgentProgressMessage = (message: ClaudeMessage): boolean => {
  if (message.type !== "progress") return false;
  const data = message.data as ProgressData | undefined;
  return data?.type === "agent_progress" && typeof data?.agentId === "string";
};

/**
 * Extract agentId from a progress message
 */
export const getAgentIdFromProgress = (message: ClaudeMessage): string | null => {
  if (!isAgentProgressMessage(message)) return null;
  const data = message.data as ProgressData;
  return data.agentId || null;
};

/**
 * Group consecutive agent progress messages by agentId
 * Only groups progress messages that appear consecutively in the message list
 */
export const groupAgentProgressMessages = (
  messages: ClaudeMessage[]
): Map<string, AgentProgressGroupResult> => {
  const groups = new Map<string, AgentProgressGroupResult>();

  let prevAgentId: string | null = null;
  let prevWasProgress = false;
  let currentGroup: { leaderId: string; entries: AgentProgressEntry[]; messageUuids: Set<string> } | null = null;

  for (const msg of messages) {
    const agentId = getAgentIdFromProgress(msg);

    if (agentId) {
      // This is a progress message
      const entry: AgentProgressEntry = {
        data: msg.data as ProgressData,
        timestamp: msg.timestamp,
        uuid: msg.uuid,
      };

      // Check if this continues the current group (same agentId and previous was also progress)
      if (prevWasProgress && prevAgentId === agentId && currentGroup) {
        // Append to current group
        currentGroup.entries.push(entry);
        currentGroup.messageUuids.add(msg.uuid);
      } else {
        // Start a new group
        currentGroup = {
          leaderId: msg.uuid,
          entries: [entry],
          messageUuids: new Set([msg.uuid]),
        };
        groups.set(msg.uuid, {
          entries: currentGroup.entries,
          messageUuids: currentGroup.messageUuids,
        });
      }

      prevAgentId = agentId;
      prevWasProgress = true;
    } else {
      // Not a progress message - reset tracking
      prevAgentId = null;
      prevWasProgress = false;
      currentGroup = null;
    }
  }

  return groups;
};
