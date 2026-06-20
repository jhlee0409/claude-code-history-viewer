/**
 * VirtualizedMessageRow Component
 *
 * Wrapper component for virtualized message rendering.
 * Uses forwardRef to support dynamic height measurement.
 * Handles both regular messages and hidden block placeholders.
 */

import { forwardRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import type { SearchFilterType } from "../../../store/useAppStore";
import type { FlattenedMessage } from "../types";
import { ClaudeMessageNode } from "./ClaudeMessageNode";
import { DateDivider } from "./DateDivider";
import { HiddenBlocksIndicator } from "./HiddenBlocksIndicator";
import { isZeroHeightMessageRow } from "../helpers/heightEstimation";

interface VirtualizedMessageRowProps {
  virtualRow: VirtualItem;
  item: FlattenedMessage;
  translateOffset?: number;
  isMatch: boolean;
  isCurrentMatch: boolean;
  searchQuery?: string;
  filterType?: SearchFilterType;
  currentMatchIndex?: number;
  // Capture mode
  isCaptureMode?: boolean;
  onHideMessage?: (uuid: string) => void;
  onRestoreOne?: (uuid: string) => void;
  onRestoreAll?: (uuids: string[]) => void;
  // Multi-selection
  isSelected?: boolean;
  onRangeSelect?: (uuid: string, modifiers: { shift: boolean; cmdOrCtrl: boolean }) => void;
  isInSubagent?: boolean;
}

/**
 * Row component with forwardRef for virtualizer measurement.
 */
export const VirtualizedMessageRow = forwardRef<
  HTMLDivElement,
  VirtualizedMessageRowProps
>(function VirtualizedMessageRow(
  {
    virtualRow,
    item,
    translateOffset = 0,
    isMatch,
    isCurrentMatch,
    searchQuery,
    filterType,
    currentMatchIndex,
    isCaptureMode,
    onHideMessage,
    onRestoreOne,
    onRestoreAll,
    isSelected,
    onRangeSelect,
    isInSubagent = false,
  },
  ref
) {
  const translateY = virtualRow.start - translateOffset;

  // Handle date divider
  if (item.type === "date-divider") {
    return (
      <div
        ref={ref}
        data-index={virtualRow.index}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${translateY}px)`,
        }}
      >
        <DateDivider timestamp={item.timestamp} />
      </div>
    );
  }

  // Handle hidden blocks placeholder
  if (item.type === "hidden-placeholder") {
    return (
      <div
        ref={ref}
        data-index={virtualRow.index}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${translateY}px)`,
        }}
      >
        <HiddenBlocksIndicator
          count={item.hiddenCount}
          hiddenUuids={item.hiddenUuids}
          onRestoreOne={onRestoreOne}
          onRestoreAll={onRestoreAll}
        />
      </div>
    );
  }

  // Regular message item
  const {
    message,
    depth,
    agentTaskGroup,
    agentProgressGroup,
    taskOperationGroup,
    taskRegistry,
  } = item;

  // Hidden rows stay in the virtual index space for navigation/search metadata,
  // but must measure as 0px or long hidden runs create blank scroll gaps.
  if (isZeroHeightMessageRow(item, isInSubagent)) {
    return (
      <div
        ref={ref}
        data-index={virtualRow.index}
        data-message-uuid={message.uuid}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${translateY}px)`,
          height: 0,
          overflow: "hidden",
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      ref={ref}
      data-index={virtualRow.index}
      className={cn(isCaptureMode && "group/capture")}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${translateY}px)`,
      }}
    >
      <ClaudeMessageNode
        message={message}
        depth={depth}
        isMatch={isMatch}
        isCurrentMatch={isCurrentMatch}
        searchQuery={searchQuery}
        filterType={filterType}
        currentMatchIndex={currentMatchIndex}
        agentTaskGroup={agentTaskGroup}
        isAgentTaskGroupMember={false}
        agentProgressGroup={agentProgressGroup}
        isAgentProgressGroupMember={false}
        taskOperationGroup={taskOperationGroup}
        taskRegistry={taskRegistry}
        isTaskOperationGroupMember={false}
        isCaptureMode={isCaptureMode}
        onHideMessage={onHideMessage}
        isSelected={isSelected}
        onRangeSelect={onRangeSelect}
      />
    </div>
  );
});
