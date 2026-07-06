/**
 * Agent Task Helpers
 *
 * Functions for grouping and processing agent task messages.
 */

import type { ClaudeMessage, ClaudeUserMessage } from "../../../types";
import type { AgentTask } from "../../toolResultRenderer";
import type { AgentTaskGroupResult } from "../types";
import { extractClaudeMessageContent, isClaudeUserMessage } from "../../../utils/messageUtils";

/**
 * Check if a message is an agent task launch (isAsync: true)
 */
/**
 * Check if a message is an agent task launch (isAsync: true)
 */
const isAgentTaskLaunchMessage = (
  message: ClaudeMessage
): message is ClaudeUserMessage & { toolUseResult: Record<string, unknown> } => {
  if (
    !isClaudeUserMessage(message) ||
    !message.toolUseResult ||
    typeof message.toolUseResult !== "object"
  )
    return false;
  const result = message.toolUseResult as Record<string, unknown>;
  return result.isAsync === true && typeof result.agentId === "string";
};

/**
 * Check if a message is an agent task completion
 * Handles: status "completed"/"error", or synchronous completion (isAsync === false)
 */
/**
 * Check if a message is an agent task completion
 * Handles: status "completed"/"error", or synchronous completion (isAsync === false)
 */
const isAgentTaskCompletionMessage = (
  message: ClaudeMessage
): message is ClaudeUserMessage & { toolUseResult: Record<string, unknown> } => {
  if (
    !isClaudeUserMessage(message) ||
    !message.toolUseResult ||
    typeof message.toolUseResult !== "object"
  )
    return false;
  const result = message.toolUseResult as Record<string, unknown>;
  if (typeof result.agentId !== "string") return false;
  // Synchronous completion (isAsync === false)
  if (result.isAsync === false) return true;
  // Async completion with status "completed" or "error" (and isAsync is undefined)
  return (
    result.isAsync === undefined &&
    (result.status === "completed" || result.status === "error")
  );
};

/**
 * Check if a message is an agent task launch (alias for isAgentTaskLaunchMessage)
 */
/**
 * Check if a message is an agent task launch (alias for isAgentTaskLaunchMessage)
 */
const isAgentTaskMessage = (
  message: ClaudeMessage
): message is ClaudeUserMessage & { toolUseResult: Record<string, unknown> } => {
  return isAgentTaskLaunchMessage(message);
};

/**
 * Extract agent task info from a message
 */
const extractAgentTask = (message: ClaudeMessage): AgentTask | null => {
  if (!isAgentTaskMessage(message)) return null;
  // We know it's a user message with toolUseResult because isAgentTaskMessage checked it
  const result = (message as { toolUseResult: Record<string, unknown> }).toolUseResult;
  return {
    agentId: String(result.agentId),
    description: String(result.description || ""),
    status: (result.status === "completed" ? "completed" :
      result.status === "error" ? "error" : "async_launched") as AgentTask["status"],
    outputFile: result.outputFile ? String(result.outputFile) : undefined,
    prompt: result.prompt ? String(result.prompt) : undefined,
  };
};

/**
 * Group agent task messages by timestamp (within 2 seconds) - non-consecutive grouping
 * Also includes completion messages linked by agentId
 */
export const groupAgentTasks = (
  messages: ClaudeMessage[]
): Map<string, AgentTaskGroupResult> => {
  const groups = new Map<string, AgentTaskGroupResult>();

  // First, extract all agent task LAUNCH messages with their timestamps
  const agentTaskMessages: { msg: ClaudeMessage; task: AgentTask; timestamp: number }[] = [];
  for (const msg of messages) {
    const task = extractAgentTask(msg);
    if (task) {
      agentTaskMessages.push({
        msg,
        task,
        timestamp: new Date(msg.timestamp).getTime(),
      });
    }
  }

  // Sort by timestamp to ensure proper grouping
  agentTaskMessages.sort((a, b) => a.timestamp - b.timestamp);

  // Group by timestamp proximity (within 2 seconds)
  let currentGroup: { leaderId: string; tasks: AgentTask[]; messageUuids: Set<string>; timestamp: number } | null = null;

  // Map to track agentId -> group for completion message linking
  const agentIdToGroup = new Map<string, AgentTaskGroupResult>();

  for (const { msg, task, timestamp } of agentTaskMessages) {
    // Check if this task belongs to the current group (within 2 seconds)
    if (currentGroup && Math.abs(timestamp - currentGroup.timestamp) <= 2000) {
      currentGroup.tasks.push(task);
      currentGroup.messageUuids.add(msg.uuid);
      agentIdToGroup.set(task.agentId, groups.get(currentGroup.leaderId)!);
    } else {
      // Start a new group
      currentGroup = {
        leaderId: msg.uuid,
        tasks: [task],
        messageUuids: new Set([msg.uuid]),
        timestamp,
      };
      const groupData = {
        tasks: currentGroup.tasks,
        messageUuids: currentGroup.messageUuids,
      };
      groups.set(currentGroup.leaderId, groupData);
      agentIdToGroup.set(task.agentId, groupData);
    }
  }

  // Now find completion messages and link them to groups by agentId
  for (const msg of messages) {
    if (isAgentTaskCompletionMessage(msg)) {
      const result = msg.toolUseResult;
      const agentId = String(result.agentId);
      const group = agentIdToGroup.get(agentId);

      if (group) {
        group.messageUuids.add(msg.uuid);
        const task = group.tasks.find(t => t.agentId === agentId);
        if (task) {
          // Set status based on result.status or fallback to "completed" for synchronous completions
          if (result.status === "error") {
            task.status = "error";
          } else {
            task.status = "completed";
          }
        }
      }
    }

    // Handle queue-operation messages with <task-notification> tags
    if (msg.type === "queue-operation") {
      const content = extractClaudeMessageContent(msg);
      if (content && typeof content === "string" && content.includes("<task-notification>")) {
        // Extract task-id from content
        const taskIdMatch = content.match(/<task-id>([^<]+)<\/task-id>/);
        const taskId = taskIdMatch?.[1];
        if (taskId) {
          const group = agentIdToGroup.get(taskId);

          if (group) {
            group.messageUuids.add(msg.uuid);
            const task = group.tasks.find(t => t.agentId === taskId);
            if (task) {
              task.status = "completed";
            }
          }
        }
      }
    }

    // Handle user messages with <task-notification> tags (batched notifications)
    if (msg.type === "user") {
      const content = extractClaudeMessageContent(msg);
      if (content && typeof content === "string" && content.includes("<task-notification>")) {
        // Extract ALL task-ids from content (may contain multiple)
        const taskIdMatches = [...content.matchAll(/<task-id>([^<]+)<\/task-id>/g)];

        for (const match of taskIdMatches) {
          const taskId = match[1];
          if (taskId) {
            const group = agentIdToGroup.get(taskId);

            if (group) {
              group.messageUuids.add(msg.uuid);
              const task = group.tasks.find(t => t.agentId === taskId);
              if (task) {
                task.status = "completed";
              }
            }
          }
        }
      }
    }
  }

  return groups;
};
