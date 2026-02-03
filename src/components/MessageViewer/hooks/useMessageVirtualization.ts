/**
 * useMessageVirtualization Hook
 *
 * Provides virtual scrolling capabilities for the message viewer
 * using @tanstack/react-virtual.
 */

import { useMemo, useCallback } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { ClaudeMessage } from "../../../types";
import type {
  FlattenedMessage,
  AgentTaskGroupResult,
  AgentProgressGroupResult,
  TaskOperationGroupResult,
} from "../types";
import {
  flattenMessageTree,
  buildUuidToIndexMap,
  findGroupLeaderIndex,
} from "../helpers/flattenMessageTree";
import {
  estimateMessageHeight,
  VIRTUALIZER_OVERSCAN,
  MIN_ROW_HEIGHT,
} from "../helpers/heightEstimation";

interface UseMessageVirtualizationOptions {
  messages: ClaudeMessage[];
  agentTaskGroups: Map<string, AgentTaskGroupResult>;
  agentTaskMemberUuids: Set<string>;
  agentProgressGroups: Map<string, AgentProgressGroupResult>;
  agentProgressMemberUuids: Set<string>;
  taskOperationGroups: Map<string, TaskOperationGroupResult>;
  taskOperationMemberUuids: Set<string>;
  getScrollElement: () => HTMLElement | null;
  /** Message UUIDs to hide (only applied when in capture mode) */
  hiddenMessageIds?: string[];
  /** Whether capture mode is active */
  isCaptureMode?: boolean;
}

interface UseMessageVirtualizationReturn {
  virtualizer: ReturnType<typeof useVirtualizer<HTMLElement, Element>>;
  flattenedMessages: FlattenedMessage[];
  uuidToIndexMap: Map<string, number>;
  virtualRows: VirtualItem[];
  totalSize: number;
  /** Scroll to a specific message by UUID */
  scrollToMessage: (uuid: string) => void;
  /** Get index for a UUID (handles group member -> leader resolution) */
  getScrollIndex: (uuid: string) => number | null;
}

export const useMessageVirtualization = ({
  messages,
  agentTaskGroups,
  agentTaskMemberUuids,
  agentProgressGroups,
  agentProgressMemberUuids,
  taskOperationGroups,
  taskOperationMemberUuids,
  getScrollElement,
  hiddenMessageIds = [],
  isCaptureMode = false,
}: UseMessageVirtualizationOptions): UseMessageVirtualizationReturn => {
  // Only apply hidden filter when in capture mode (hybrid approach)
  const effectiveHiddenIds = useMemo(
    () => (isCaptureMode ? hiddenMessageIds : []),
    [isCaptureMode, hiddenMessageIds]
  );

  // Flatten message tree with group information
  const flattenedMessages = useMemo(
    () => {
      if (import.meta.env.DEV && messages.length > 0) {
        const start = performance.now();
        const result = flattenMessageTree({
          messages,
          agentTaskGroups,
          agentTaskMemberUuids,
          agentProgressGroups,
          agentProgressMemberUuids,
          taskOperationGroups,
          taskOperationMemberUuids,
          hiddenMessageIds: effectiveHiddenIds,
        });
        if (import.meta.env.DEV) {
          console.debug(`[useMessageVirtualization] flattenMessageTree: ${messages.length} → ${result.length} items (${effectiveHiddenIds.length} hidden), ${(performance.now() - start).toFixed(1)}ms`);
        }
        return result;
      }
      return flattenMessageTree({
        messages,
        agentTaskGroups,
        agentTaskMemberUuids,
        agentProgressGroups,
        agentProgressMemberUuids,
        taskOperationGroups,
        taskOperationMemberUuids,
        hiddenMessageIds: effectiveHiddenIds,
      });
    },
    [
      messages,
      agentTaskGroups,
      agentTaskMemberUuids,
      agentProgressGroups,
      agentProgressMemberUuids,
      taskOperationGroups,
      taskOperationMemberUuids,
      effectiveHiddenIds,
    ]
  );

  // UUID to index map for quick lookups
  const uuidToIndexMap = useMemo(
    () => buildUuidToIndexMap(flattenedMessages),
    [flattenedMessages]
  );

  // Height estimation function
  const estimateSize = useCallback(
    (index: number) => {
      const item = flattenedMessages[index];
      if (!item) return MIN_ROW_HEIGHT;
      return estimateMessageHeight(item);
    },
    [flattenedMessages]
  );

  // Initialize virtualizer
  const virtualizer = useVirtualizer({
    count: flattenedMessages.length,
    getScrollElement,
    estimateSize,
    overscan: VIRTUALIZER_OVERSCAN,
    // Enable dynamic measurement
    measureElement: (element) => {
      if (!element) return MIN_ROW_HEIGHT;
      // Group members render with height:0 and aria-hidden - respect that
      if (element.getAttribute("aria-hidden") === "true") return 0;
      const height = element.getBoundingClientRect().height;
      return height > 0 ? height : MIN_ROW_HEIGHT;
    },
  });

  // Get scroll index for a UUID (resolves group members to their leaders)
  const getScrollIndex = useCallback(
    (uuid: string): number | null => {
      // Direct lookup
      const directIndex = uuidToIndexMap.get(uuid);
      if (directIndex !== undefined) {
        const item = flattenedMessages[directIndex];
        // If this is a group member, find the leader instead
        if (item?.type === "message" && (item.isGroupMember || item.isProgressGroupMember)) {
          const leaderIndex = findGroupLeaderIndex(
            uuid,
            flattenedMessages,
            agentTaskGroups,
            agentProgressGroups
          );
          return leaderIndex ?? directIndex;
        }
        return directIndex;
      }
      return null;
    },
    [
      uuidToIndexMap,
      flattenedMessages,
      agentTaskGroups,
      agentProgressGroups,
    ]
  );

  // Scroll to message by UUID
  const scrollToMessage = useCallback(
    (uuid: string) => {
      const index = getScrollIndex(uuid);
      if (index !== null) {
        virtualizer.scrollToIndex(index, { align: "center" });
      }
    },
    [getScrollIndex, virtualizer]
  );

  return {
    virtualizer,
    flattenedMessages,
    uuidToIndexMap,
    virtualRows: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    scrollToMessage,
    getScrollIndex,
  };
};
