/**
 * useMessageVirtualization Hook
 *
 * Provides virtual scrolling capabilities for the message viewer
 * using @tanstack/react-virtual.
 */

import { useMemo, useCallback, useLayoutEffect, useRef } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { ENABLE_WHEEL_TRANSACTION_PROTOTYPE, useTranscriptWheelBoundary, useTranscriptWheelTransaction } from "./useTranscriptWheelTransaction";
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
  /** Whether the viewer is currently showing a subagent session. */
  isInSubagent?: boolean;
  /** Height before the virtual list inside the same scroll viewport. */
  scrollMargin?: number;
  /** Isolated input-path prototype; removal restores native wheel ownership. */
  wheelTransactionPrototype?: boolean;
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
  /** Offset that row transforms should subtract from `virtualRow.start`. */
  rowTranslateOffset: number;
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
  isInSubagent = false,
  scrollMargin = 0,
  wheelTransactionPrototype = ENABLE_WHEEL_TRANSACTION_PROTOTYPE,
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
      return estimateMessageHeight(item, isInSubagent);
    },
    [flattenedMessages, isInSubagent]
  );

  const getItemKey = useCallback(
    (index: number) => {
      const item = flattenedMessages[index];
      if (!item) return index;

      if (item.type === "message") {
        return item.message.uuid;
      }

      if (item.type === "date-divider") {
        return `date-divider:${item.timestamp}:${index}`;
      }

      return `hidden:${item.hiddenUuids[0] ?? index}:${item.hiddenCount}`;
    },
    [flattenedMessages]
  );

  // Initialize virtualizer
  const wheelTransaction = useTranscriptWheelTransaction();
  const virtualizer = useVirtualizer({
    count: flattenedMessages.length,
    getScrollElement,
    estimateSize,
    getItemKey,
    overscan: VIRTUALIZER_OVERSCAN,
    scrollMargin,
    observeElementOffset: wheelTransaction.observeOffset,
    scrollToFn: wheelTransaction.scrollToFn,
    useFlushSync: !wheelTransaction.active.current,
    // Consume layout measurements before paint. Deferring RO to another rAF
    // leaves newly mounted rows at estimated positions during wheel scrolling.
    useAnimationFrameWithResizeObserver: false,
    // Enable dynamic measurement
    measureElement: (element) => {
      if (!element) return MIN_ROW_HEIGHT;
      // Group members render with height:0 and aria-hidden - respect that
      if (element.getAttribute("aria-hidden") === "true") return 0;
      const height = element.getBoundingClientRect().height;
      return height > 0 ? height : MIN_ROW_HEIGHT;
    },
  });

  const mountedRowKeys = useRef(new WeakMap<Element, VirtualItem["key"]>());
  useTranscriptWheelBoundary(wheelTransactionPrototype, virtualizer, wheelTransaction);
  useLayoutEffect(() => {
    const measurements: { index: number; height: number }[] = [];
    for (const [key, node] of virtualizer.elementsCache) {
      const index = virtualizer.indexFromElement(node);
      // A removed/reindexed node must not resize the new occupant of its index.
      if (!node.isConnected || !Number.isInteger(index) || index < 0 ||
          index >= virtualizer.options.count || virtualizer.options.getItemKey(index) !== key) continue;
      if (mountedRowKeys.current.get(node) === key) continue;
      mountedRowKeys.current.set(node, key);
      // Idle refs already measure synchronously. During wheel scrolling core
      // skips that read; reconcile each new node/key once before paint instead
      // of waiting for RO (and another estimated range to mount).
      if (virtualizer.isScrolling) {
        measurements.push({ index, height: virtualizer.options.measureElement(node, undefined, virtualizer) });
      }
    }
    if (measurements.length === 0) return;

    // resizeItem retains core's anchor adjustments. Layout-effect updates are
    // already committed before paint; don't ask the React adapter to flushSync
    // reentrantly inside this commit. Restore normal scroll/RO notification.
    const onChange = virtualizer.options.onChange;
    virtualizer.setOptions({ ...virtualizer.options, onChange: instance => onChange(instance, false) });
    try {
      for (const { index, height } of measurements) virtualizer.resizeItem(index, height);
    } finally {
      virtualizer.setOptions({ ...virtualizer.options, onChange });
    }
  });

  // Get scroll index for a UUID (resolves group members to their leaders)
  const getScrollIndex = useCallback(
    (uuid: string): number | null => {
      // Direct lookup
      const directIndex = uuidToIndexMap.get(uuid);
      if (directIndex !== undefined) {
        const item = flattenedMessages[directIndex];
        // If this is a group member, find the leader instead
        if (item?.type === "message" && (item.isGroupMember || item.isProgressGroupMember || item.isTaskOperationGroupMember)) {
          const leaderIndex = findGroupLeaderIndex(
            uuid,
            flattenedMessages,
            agentTaskGroups,
            agentProgressGroups,
            taskOperationGroups
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
      taskOperationGroups,
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
    rowTranslateOffset: scrollMargin,
  };
};
