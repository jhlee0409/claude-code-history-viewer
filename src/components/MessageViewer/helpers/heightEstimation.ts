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
 */
export function estimateMessageHeight(item: FlattenedMessage): number {
  // Hidden placeholder has fixed height
  if (item.type === "hidden-placeholder") {
    return 40; // Compact placeholder height
  }

  const { message, isGroupMember, isProgressGroupMember, isTaskOperationGroupMember, agentTaskGroup, agentProgressGroup } = item;

  // Group members are hidden (height: 0)
  if (isGroupMember || isProgressGroupMember || isTaskOperationGroupMember) {
    return HEIGHT_DEFAULTS.hidden;
  }

  // Sidechain messages are hidden
  if (message.isSidechain) {
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
