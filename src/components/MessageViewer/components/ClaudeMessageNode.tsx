/**
 * ClaudeMessageNode Component
 *
 * Renders individual message nodes with support for various message types.
 */

import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";
import { cn } from "@/lib/utils";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import type { ProgressData } from "../../../types";
import { ClaudeContentArrayRenderer } from "../../contentRenderer";
import {
  ClaudeToolUseDisplay,
  MessageContentDisplay,
  ToolExecutionResultRouter,
  ProgressRenderer,
  AgentProgressGroupRenderer,
  FileHistorySnapshotRenderer,
  SystemMessageRenderer,
} from "../../messageRenderer";
import { AgentTaskGroupRenderer, TaskOperationGroupRenderer } from "../../toolResultRenderer";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";
import { isEmptyMessage } from "../helpers/messageHelpers";
import { isToolUseContent, isToolResultContent } from "../../../utils/typeGuards";
import { isActionModifier } from "../../../utils/platform";
import { MessageHeader } from "./MessageHeader";
import { SummaryMessage } from "./SummaryMessage";
import type { MessageNodeProps } from "../types";

// Capture mode hover background style (uses named group to avoid conflicts)
const CAPTURE_HOVER_BG = "group-hover/capture:bg-red-500/5 group-hover/capture:ring-1 group-hover/capture:ring-red-500/20";

// Selection highlight style
const SELECTED_BG = "bg-blue-500/10 ring-1 ring-blue-500/40";

// Click priority: interactive elements take precedence over capture selection
const INTERACTIVE_SELECTOR = "button, a, summary, input, select, textarea, [role='button']";

export const ClaudeMessageNode = React.memo(({
  message,
  isCurrentMatch,
  isMatch,
  searchQuery,
  filterType = "content",
  currentMatchIndex,
  agentTaskGroup,
  isAgentTaskGroupMember,
  agentProgressGroup,
  isAgentProgressGroupMember,
  taskOperationGroup,
  taskRegistry,
  isTaskOperationGroupMember,
  isCaptureMode,
  onHideMessage,
  isSelected,
  onRangeSelect,
}: MessageNodeProps) => {
  const { t } = useTranslation();
  const messageFilter = useAppStore((s) => s.messageFilter);
  const subagentSessions = useAppStore((s) => s.subagentSessions);
  const navigateToSubagent = useAppStore((s) => s.navigateToSubagent);

  const handleViewSubagent = subagentSessions.length > 0
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ? (_agentId: string) => {
        const match = subagentSessions[0];
        if (match) {
          void navigateToSubagent(match);
        }
      }
    : undefined;

  const handleSelectionClick = isCaptureMode && onRangeSelect
    ? (e: React.MouseEvent) => {
        // Let interactive elements handle their own clicks
        if ((e.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
        // Prevent browser native text selection on Shift+click
        e.preventDefault();
        onRangeSelect(message.uuid, {
          shift: e.shiftKey,
          cmdOrCtrl: isActionModifier(e),
        });
      }
    : undefined;

  const selectionHighlight = isCaptureMode && isSelected ? SELECTED_BG : "";
  const selectionCursor = isCaptureMode && onRangeSelect
    ? "cursor-crosshair select-none"
    : "";

  // Capture mode hide button - appears on hover
  const CaptureHideButton = isCaptureMode && onHideMessage ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onHideMessage(message.uuid);
      }}
      className={cn(
        "absolute top-3 right-3 z-10",
        "flex items-center justify-center",
        "w-7 h-7 rounded-lg",
        // Glass morphism effect
        "bg-zinc-900/80 backdrop-blur-sm",
        "border border-zinc-700/50",
        // Hover state
        "hover:bg-red-500/90 hover:border-red-400/50",
        "hover:shadow-lg hover:shadow-red-500/20",
        // Text/icon
        "text-zinc-400 hover:text-white",
        // Animation - appears on capture mode group hover only
        "opacity-0 group-hover/capture:opacity-100",
        "translate-y-1 group-hover/capture:translate-y-0",
        "transition-all duration-200 ease-out"
      )}
      title={t("captureMode.hideBlock")}
      aria-label={t("captureMode.hideBlock")}
    >
      <X className="w-4 h-4" strokeWidth={2.5} />
    </button>
  ) : null;

  if (message.isSidechain) {
    return null;
  }

  // Render hidden placeholders for group members
  if (isAgentTaskGroupMember) {
    return (
      <div
        data-message-uuid={message.uuid}
        className="hidden"
        aria-hidden="true"
      />
    );
  }

  if (isAgentProgressGroupMember) {
    return (
      <div
        data-message-uuid={message.uuid}
        className="hidden"
        aria-hidden="true"
      />
    );
  }

  if (isTaskOperationGroupMember) {
    return (
      <div
        data-message-uuid={message.uuid}
        className="hidden"
        aria-hidden="true"
      />
    );
  }

  // Skip empty messages
  if (isEmptyMessage(message)) {
    return null;
  }

  // Render grouped agent tasks
  if (agentTaskGroup && agentTaskGroup.length > 0) {
    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative w-full px-2 md:px-4 py-2 transition-all duration-200",
            isCaptureMode && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <div className="max-w-4xl mx-auto">
            <AgentTaskGroupRenderer tasks={agentTaskGroup} timestamp={message.timestamp} />
          </div>
        </div>
      </ExpandKeyProvider>
    );
  }

  // Render grouped agent progress
  if (agentProgressGroup && agentProgressGroup.entries.length > 0) {
    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative w-full px-2 md:px-4 py-2 transition-all duration-200",
            isCaptureMode && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <div className="max-w-4xl mx-auto">
            <AgentProgressGroupRenderer
              entries={agentProgressGroup.entries}
              agentId={agentProgressGroup.agentId}
            />
          </div>
        </div>
      </ExpandKeyProvider>
    );
  }

  // Render grouped task operations
  if (taskOperationGroup && taskOperationGroup.length > 0) {
    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative w-full px-2 md:px-4 py-2 transition-all duration-200",
            isCaptureMode && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <div className="max-w-4xl mx-auto">
            <TaskOperationGroupRenderer operations={taskOperationGroup} taskRegistry={taskRegistry} />
          </div>
        </div>
      </ExpandKeyProvider>
    );
  }

  // Summary messages
  if (message.type === "summary") {
    const summaryContent = typeof message.content === "string"
      ? message.content
      : "";
    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative max-w-4xl mx-auto transition-all duration-200",
            isCaptureMode && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <SummaryMessage content={summaryContent} timestamp={message.timestamp} />
        </div>
      </ExpandKeyProvider>
    );
  }

  // File history snapshot messages
  if (message.type === "file-history-snapshot") {
    if (!message.snapshot) {
      return null;
    }

    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative w-full px-2 md:px-4 py-2 transition-all duration-200",
            isCaptureMode && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <div className="max-w-4xl mx-auto">
            <FileHistorySnapshotRenderer
              messageId={message.messageId ?? message.uuid}
              snapshot={message.snapshot}
              isSnapshotUpdate={Boolean(message.isSnapshotUpdate)}
            />
          </div>
        </div>
      </ExpandKeyProvider>
    );
  }

  // Progress messages
  if (message.type === "progress" && message.data) {
    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative w-full px-2 md:px-4 py-1 transition-all duration-200",
            isCaptureMode && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <div className="max-w-4xl mx-auto">
            <ProgressRenderer
              data={message.data as ProgressData}
              toolUseID={message.toolUseID}
              parentToolUseID={message.parentToolUseID}
            />
          </div>
        </div>
      </ExpandKeyProvider>
    );
  }

  // System messages (local_command, compact_boundary, api_error, etc.)
  if (message.type === "system") {
    const contentStr = typeof message.content === "string" ? message.content : undefined;
    return (
      <ExpandKeyProvider value={message.uuid}>
        <div
          data-message-uuid={message.uuid}
          onClick={handleSelectionClick}
          className={cn(
            "relative w-full px-2 md:px-4 py-1 transition-all duration-200",
            isCurrentMatch && "bg-highlight-current ring-2 ring-warning",
            isMatch && !isCurrentMatch && "bg-highlight",
            isCaptureMode && !isCurrentMatch && !isMatch && !isSelected && CAPTURE_HOVER_BG,
            selectionHighlight,
            selectionCursor
          )}
        >
          {CaptureHideButton}
          <div className="max-w-4xl mx-auto">
            <SystemMessageRenderer
              content={contentStr}
              subtype={message.subtype}
              level={message.level}
              hookCount={message.hookCount}
              hookInfos={message.hookInfos}
              stopReason={message.stopReasonSystem}
              preventedContinuation={message.preventedContinuation}
              durationMs={message.durationMs}
              compactMetadata={message.compactMetadata}
              microcompactMetadata={message.microcompactMetadata}
            />
          </div>
        </div>
      </ExpandKeyProvider>
    );
  }

  const hasInlineToolResult =
    Array.isArray(message.content) && message.content.some(isToolResultContent);
  const shouldRenderLegacyToolResult =
    (message.type === "user" || message.type === "assistant") &&
    message.toolUseResult != null &&
    !hasInlineToolResult;

  // Default message rendering
  return (
    <ExpandKeyProvider value={message.uuid}>
      <div
        data-message-uuid={message.uuid}
        onClick={handleSelectionClick}
        className={cn(
          "relative w-full px-2 md:px-4 py-2 transition-all duration-200",
          message.isSidechain && "bg-muted",
          // Search highlight
          isCurrentMatch && "bg-highlight-current ring-2 ring-warning",
          isMatch && !isCurrentMatch && "bg-highlight",
          // Capture mode hover effect
          isCaptureMode && !isCurrentMatch && !isMatch && !isSelected && CAPTURE_HOVER_BG,
          // Range selection highlight
          selectionHighlight,
          selectionCursor
        )}
      >
        {CaptureHideButton}
        <div className="max-w-4xl mx-auto">
          <MessageHeader message={message} />

          <div className="w-full">
            {(message.type !== "assistant" || messageFilter.contentTypes.text) && (
              <MessageContentDisplay
                content={extractClaudeMessageContent(message)}
                messageType={message.type}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            )}

            {message.content &&
              Array.isArray(message.content) && (
                <div className="mb-2">
                  <ClaudeContentArrayRenderer
                    content={message.content}
                    searchQuery={searchQuery}
                    filterType={filterType}
                    isCurrentMatch={isCurrentMatch}
                    currentMatchIndex={currentMatchIndex}
                    skipToolResults={shouldRenderLegacyToolResult}
                    skipText={
                      (message.type === "assistant" && !messageFilter.contentTypes.text) ||
                      (message.type === "assistant" &&
                      !!extractClaudeMessageContent(message))
                    }
                    skipThinking={message.type === "assistant" && !messageFilter.contentTypes.thinking}
                    skipCommands={message.type === "assistant" && !messageFilter.contentTypes.commands}
                    skipToolCalls={message.type === "assistant" && !messageFilter.contentTypes.toolCalls}
                    onViewSubagent={handleViewSubagent}
                  />
                </div>
              )}

            {messageFilter.contentTypes.toolCalls &&
              message.type === "assistant" &&
              message.toolUse &&
              !(
                Array.isArray(message.content) &&
                message.content.some(isToolUseContent)
              ) && <ClaudeToolUseDisplay toolUse={message.toolUse} />}

            {(message.type !== "assistant" || messageFilter.contentTypes.toolCalls) && shouldRenderLegacyToolResult && (
                <ToolExecutionResultRouter
                  toolResult={message.toolUseResult!}
                  searchQuery={searchQuery}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                />
              )}
          </div>
        </div>
      </div>
    </ExpandKeyProvider>
  );
});

ClaudeMessageNode.displayName = "ClaudeMessageNode";
