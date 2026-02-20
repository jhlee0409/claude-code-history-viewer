/**
 * ClaudeMessageNode Component
 *
 * Renders individual message nodes with support for various message types.
 */

import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ProgressData } from "../../../types";
import { ClaudeContentArrayRenderer } from "../../contentRenderer";
import {
  ClaudeToolUseDisplay,
  MessageContentDisplay,
  ToolExecutionResultRouter,
  ProgressRenderer,
  AgentProgressGroupRenderer,
} from "../../messageRenderer";
import { AgentTaskGroupRenderer, TaskOperationGroupRenderer } from "../../toolResultRenderer";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";
import { isEmptyMessage } from "../helpers/messageHelpers";
import { isToolUseContent, isToolResultContent } from "../../../utils/typeGuards";
import { MessageHeader } from "./MessageHeader";
import { SummaryMessage } from "./SummaryMessage";
import type { MessageNodeProps } from "../types";

// Capture mode hover background style (uses named group to avoid conflicts)
const CAPTURE_HOVER_BG = "group-hover/capture:bg-red-500/5 group-hover/capture:ring-1 group-hover/capture:ring-red-500/20";

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
}: MessageNodeProps) => {
  const { t } = useTranslation();

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
      <div
        data-message-uuid={message.uuid}
        className={cn(
          "relative w-full px-4 py-2 transition-all duration-200",
          isCaptureMode && CAPTURE_HOVER_BG
        )}
      >
        {CaptureHideButton}
        <div className="max-w-4xl mx-auto">
          <AgentTaskGroupRenderer tasks={agentTaskGroup} timestamp={message.timestamp} />
        </div>
      </div>
    );
  }

  // Render grouped agent progress
  if (agentProgressGroup && agentProgressGroup.entries.length > 0) {
    return (
      <div
        data-message-uuid={message.uuid}
        className={cn(
          "relative w-full px-4 py-2 transition-all duration-200",
          isCaptureMode && CAPTURE_HOVER_BG
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
    );
  }

  // Render grouped task operations
  if (taskOperationGroup && taskOperationGroup.length > 0) {
    return (
      <div
        data-message-uuid={message.uuid}
        className={cn(
          "relative w-full px-4 py-2 transition-all duration-200",
          isCaptureMode && CAPTURE_HOVER_BG
        )}
      >
        {CaptureHideButton}
        <div className="max-w-4xl mx-auto">
          <TaskOperationGroupRenderer operations={taskOperationGroup} taskRegistry={taskRegistry} />
        </div>
      </div>
    );
  }

  // Summary messages
  if (message.type === "summary") {
    const summaryContent = typeof message.content === "string"
      ? message.content
      : "";
    return (
      <div
        data-message-uuid={message.uuid}
        className={cn(
          "relative max-w-4xl mx-auto transition-all duration-200",
          isCaptureMode && CAPTURE_HOVER_BG
        )}
      >
        {CaptureHideButton}
        <SummaryMessage content={summaryContent} timestamp={message.timestamp} />
      </div>
    );
  }

  // Progress messages
  if (message.type === "progress" && message.data) {
    return (
      <div
        data-message-uuid={message.uuid}
        className={cn(
          "relative w-full px-4 py-1 transition-all duration-200",
          isCaptureMode && CAPTURE_HOVER_BG
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
    <div
      data-message-uuid={message.uuid}
      className={cn(
        "relative w-full px-4 py-2 transition-all duration-200",
        message.isSidechain && "bg-muted",
        // Search highlight
        isCurrentMatch && "bg-highlight-current ring-2 ring-warning",
        isMatch && !isCurrentMatch && "bg-highlight",
        // Capture mode hover effect
        isCaptureMode && !isCurrentMatch && !isMatch && CAPTURE_HOVER_BG
      )}
    >
      {CaptureHideButton}
      <div className="max-w-4xl mx-auto">
        <MessageHeader message={message} />

        <div className="w-full">
          <MessageContentDisplay
            content={extractClaudeMessageContent(message)}
            messageType={message.type}
            searchQuery={searchQuery}
            isCurrentMatch={isCurrentMatch}
            currentMatchIndex={currentMatchIndex}
          />

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
                    message.type === "assistant" &&
                    !!extractClaudeMessageContent(message)
                  }
                />
              </div>
            )}

          {message.type === "assistant" &&
            message.toolUse &&
            !(
              Array.isArray(message.content) &&
              message.content.some(isToolUseContent)
            ) && <ClaudeToolUseDisplay toolUse={message.toolUse} />}

          {shouldRenderLegacyToolResult && (
              <ToolExecutionResultRouter
                toolResult={message.toolUseResult!}
                depth={0}
                searchQuery={searchQuery}
                isCurrentMatch={isCurrentMatch}
                currentMatchIndex={currentMatchIndex}
              />
            )}
        </div>
      </div>
    </div>
  );
});

ClaudeMessageNode.displayName = "ClaudeMessageNode";
