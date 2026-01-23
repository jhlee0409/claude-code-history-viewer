/**
 * VirtualizedMessageRow Component
 *
 * Wrapper component for virtualized message rendering.
 * Uses forwardRef to support dynamic height measurement.
 */

import { forwardRef } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { SearchFilterType } from "../../../store/useAppStore";
import type { FlattenedMessage } from "../types";
import { ClaudeMessageNode } from "./ClaudeMessageNode";

interface VirtualizedMessageRowProps {
  virtualRow: VirtualItem;
  item: FlattenedMessage;
  isMatch: boolean;
  isCurrentMatch: boolean;
  searchQuery?: string;
  filterType?: SearchFilterType;
  currentMatchIndex?: number;
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
    isMatch,
    isCurrentMatch,
    searchQuery,
    filterType,
    currentMatchIndex,
  },
  ref
) {
  const {
    message,
    depth,
    isGroupMember,
    isProgressGroupMember,
    agentTaskGroup,
    agentProgressGroup,
  } = item;

  // Group members render as hidden placeholders for DOM presence (search needs them)
  // but with zero height they won't affect layout
  if (isGroupMember || isProgressGroupMember) {
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
          transform: `translateY(${virtualRow.start}px)`,
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
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${virtualRow.start}px)`,
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
      />
    </div>
  );
});
