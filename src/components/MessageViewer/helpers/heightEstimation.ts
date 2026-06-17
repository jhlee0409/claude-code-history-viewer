/**
 * Height Estimation Helper
 *
 * Estimates message heights for virtual scrolling based on message type and content.
 */

import type { FlattenedMessage } from "../types";

// Default heights by message type (in pixels)
const HEIGHT_DEFAULTS = {
  summary: 80,
  progress: 60,
  agentTaskGroup: 150,
  agentProgressGroup: 120,
  toolResult: 200,
  assistant: 180,
  user: 120,
  system: 100,
  default: 120,
  // Hidden group members
  hidden: 0,
} as const;

/**
 * Estimate the height of a message for virtual scrolling.
 * This is used as the initial estimate before actual measurement.
 *
 * @param isInSubagent Whether the viewer is currently inside a subagent
 *   session. Subagent sessions consist entirely of `isSidechain` messages
 *   that are rendered at full height (the sidechain hide-rule is bypassed),
 *   so they must NOT be estimated at 0 — see {@link estimateMessageHeight}
 *   sidechain branch and `ClaudeMessageNode`'s matching `isInSubagent` guard.
 */
export function estimateMessageHeight(
  item: FlattenedMessage,
  isInSubagent = false
): number {
  // Hidden placeholder has fixed height
  if (item.type === "hidden-placeholder") {
    return 40; // Compact placeholder height
  }

  // Date divider has fixed height
  if (item.type === "date-divider") {
    return 36;
  }

  const { message, isGroupMember, isProgressGroupMember, isTaskOperationGroupMember, agentTaskGroup, agentProgressGroup } = item;

  // Group members are hidden (height: 0)
  if (isGroupMember || isProgressGroupMember || isTaskOperationGroupMember) {
    return HEIGHT_DEFAULTS.hidden;
  }

  // Sidechain messages are hidden in normal sessions (ClaudeMessageNode returns
  // null for them), so estimate 0. Inside a subagent session the hide-rule is
  // bypassed and every row IS sidechain rendered at full height — estimating 0
  // there makes the virtualizer believe the whole list has ~0 total height and
  // mount all rows at once (the #334 crash on large subagent sessions).
  if (message.isSidechain && !isInSubagent) {
    return HEIGHT_DEFAULTS.hidden;
  }

  // Agent task group leader
  if (agentTaskGroup && agentTaskGroup.length > 0) {
    // Estimate based on number of tasks
    return HEIGHT_DEFAULTS.agentTaskGroup + agentTaskGroup.length * 40;
  }

  // Agent progress group leader
  if (agentProgressGroup && agentProgressGroup.entries.length > 0) {
    return HEIGHT_DEFAULTS.agentProgressGroup;
  }

  // Summary messages (collapsible)
  if (message.type === "summary") {
    return HEIGHT_DEFAULTS.summary;
  }

  // Progress messages
  if (message.type === "progress") {
    return HEIGHT_DEFAULTS.progress;
  }

  // Messages with tool results tend to be taller
  if ((message.type === "user" || message.type === "assistant") && message.toolUseResult) {
    return HEIGHT_DEFAULTS.toolResult;
  }

  // Type-based estimation
  switch (message.type) {
    case "assistant":
      return HEIGHT_DEFAULTS.assistant;
    case "user":
      return HEIGHT_DEFAULTS.user;
    case "system":
      return HEIGHT_DEFAULTS.system;
    default:
      return HEIGHT_DEFAULTS.default;
  }
}

/**
 * Get default overscan count based on performance needs.
 * Higher values = smoother scrolling but more DOM nodes.
 */
export const VIRTUALIZER_OVERSCAN = 5;

/**
 * Minimum height for measurement (prevents zero-height issues).
 */
export const MIN_ROW_HEIGHT = 20;
