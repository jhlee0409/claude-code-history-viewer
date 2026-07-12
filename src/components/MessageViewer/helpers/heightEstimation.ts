/**
 * Height Estimation Helper
 *
 * Estimates message heights for virtual scrolling based on message type and content.
 */

import type { FlattenedMessage } from "../types";
import { isEmptyMessage } from "./messageHelpers";

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

const CONTENT_WRAP_CHARS = 88;
const CONTENT_LINE_HEIGHT = 18;
const MAX_TEXT_EXTRA_HEIGHT = 1400;
const MAX_TOOL_EXTRA_HEIGHT = 2200;
const MAX_INSPECTED_CHARS = 16000;

interface ContentMeasure {
  chars: number;
  lineBreaks: number;
}

function measureUnknownContent(value: unknown, measure: ContentMeasure): void {
  if (measure.chars >= MAX_INSPECTED_CHARS || value == null) {
    return;
  }

  if (typeof value === "string") {
    const remaining = MAX_INSPECTED_CHARS - measure.chars;
    const slice = value.slice(0, remaining);
    measure.chars += slice.length;
    measure.lineBreaks += slice.split("\n").length - 1;
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    measure.chars += String(value).length;
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      measureUnknownContent(item, measure);
      if (measure.chars >= MAX_INSPECTED_CHARS) return;
    }
    return;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      measureUnknownContent(nested, measure);
      if (measure.chars >= MAX_INSPECTED_CHARS) return;
    }
  }
}

function estimateContentExtraHeight(
  item: Extract<FlattenedMessage, { type: "message" }>
): number {
  const { message } = item;
  const messageRecord = message as unknown as Record<string, unknown>;
  const measure: ContentMeasure = { chars: 0, lineBreaks: 0 };

  measureUnknownContent(messageRecord.content, measure);
  measureUnknownContent(messageRecord.summary, measure);
  measureUnknownContent(messageRecord.data, measure);
  measureUnknownContent(messageRecord.toolUse, measure);
  measureUnknownContent(messageRecord.toolUseResult, measure);

  if (measure.chars === 0) {
    return 0;
  }

  const wrappedLines = Math.ceil(measure.chars / CONTENT_WRAP_CHARS);
  const explicitLines = measure.lineBreaks + 1;
  const estimatedLines = Math.max(wrappedLines, explicitLines);
  const includedBaseLines = message.type === "progress" ? 2 : 4;
  const extraLines = Math.max(0, estimatedLines - includedBaseLines);
  const hasToolPayload =
    messageRecord.toolUse != null || messageRecord.toolUseResult != null;

  return Math.min(
    extraLines * CONTENT_LINE_HEIGHT,
    hasToolPayload ? MAX_TOOL_EXTRA_HEIGHT : MAX_TEXT_EXTRA_HEIGHT
  );
}

export function isZeroHeightMessageRow(
  item: FlattenedMessage,
  isInSubagent = false
): boolean {
  if (item.type !== "message") {
    return false;
  }

  const {
    message,
    isGroupMember,
    isProgressGroupMember,
    isTaskOperationGroupMember,
  } = item;

  if (isGroupMember || isProgressGroupMember || isTaskOperationGroupMember) {
    return true;
  }

  if (message.isSidechain && !isInSubagent) {
    return true;
  }

  return isEmptyMessage(message);
}

/**
 * Estimate the height of a message for virtual scrolling.
 * This is used as the initial estimate before actual measurement.
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

  const { message, agentTaskGroup, agentProgressGroup } = item;

  if (isZeroHeightMessageRow(item, isInSubagent)) {
    return HEIGHT_DEFAULTS.hidden;
  }

  // Agent task group leader
  if (agentTaskGroup && agentTaskGroup.length > 0) {
    // Estimate based on number of tasks
    return (
      HEIGHT_DEFAULTS.agentTaskGroup +
      agentTaskGroup.length * 40 +
      estimateContentExtraHeight(item)
    );
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
    return HEIGHT_DEFAULTS.toolResult + estimateContentExtraHeight(item);
  }

  const contentExtra = estimateContentExtraHeight(item);

  // Type-based estimation
  switch (message.type) {
    case "assistant":
      return HEIGHT_DEFAULTS.assistant + contentExtra;
    case "user":
      return HEIGHT_DEFAULTS.user + contentExtra;
    case "system":
      return HEIGHT_DEFAULTS.system + contentExtra;
    default:
      return HEIGHT_DEFAULTS.default + contentExtra;
  }
}

/**
 * Get default overscan count based on performance needs.
 * Higher values = smoother scrolling but more DOM nodes.
 */
export const VIRTUALIZER_OVERSCAN = 12;

/**
 * Minimum height for measurement (prevents zero-height issues).
 */
export const MIN_ROW_HEIGHT = 20;
