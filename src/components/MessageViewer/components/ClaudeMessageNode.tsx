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
import { AgentTaskGroupRenderer } from "../../toolResultRenderer";
import { extractClaudeMessageContent } from "../../../utils/messageUtils";
import { isEmptyMessage } from "../helpers/messageHelpers";
import { MessageHeader } from "./MessageHeader";
import { SummaryMessage } from "./SummaryMessage";
import type { MessageNodeProps } from "../types";

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
  isCaptureMode,
  onHideMessage,
}: MessageNodeProps) => {
  const { t } = useTranslation();

  // Capture mode hide button - sophisticated editorial style
  // Appears on hover with smooth entrance animation
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
        // Animation
        "opacity-0 group-hover:opacity-100",
        "translate-y-1 group-hover:translate-y-0",
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

  // Render hidden placeholders for group members to preserve DOM nodes for search/highlight
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

  // Skip empty messages (no content, or only command tags)
  if (isEmptyMessage(message)) {
    return null;
  }

  // Render grouped agent tasks
  if (agentTaskGroup && agentTaskGroup.length > 0) {
    return (
      <div data-message-uuid={message.uuid} className={cn("relative w-full px-4 py-2", isCaptureMode && "group")}>
        {CaptureHideButton}
        <div className="max-w-4xl mx-auto">
          <AgentTaskGroupRenderer tasks={agentTaskGroup} timestamp={message.timestamp} />
        </div>
      </div>
    );
  }

  // Render grouped agent progress (replaces individual ProgressRenderer for agent_progress)
  if (agentProgressGroup && agentProgressGroup.entries.length > 0) {
    return (
      <div data-message-uuid={message.uuid} className={cn("relative w-full px-4 py-2", isCaptureMode && "group")}>
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

  // Summary messages get special collapsible rendering
  if (message.type === "summary") {
    const summaryContent = typeof message.content === "string"
      ? message.content
      : "";
    return (
      <div data-message-uuid={message.uuid} className={cn("relative max-w-4xl mx-auto", isCaptureMode && "group")}>
        {CaptureHideButton}
        <SummaryMessage content={summaryContent} timestamp={message.timestamp} />
      </div>
    );
  }

  // Progress messages get special rendering (non-agent progress types)
  if (message.type === "progress" && message.data) {
    return (
      <div data-message-uuid={message.uuid} className={cn("relative w-full px-4 py-1", isCaptureMode && "group")}>
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

  return (
    <div
      data-message-uuid={message.uuid}
      className={cn(
        "relative w-full px-4 py-2 transition-colors duration-300",
        message.isSidechain && "bg-muted",
        // 현재 매치된 메시지 강조
        isCurrentMatch && "bg-highlight-current ring-2 ring-warning",
        // 다른 매치 메시지 연한 강조
        isMatch && !isCurrentMatch && "bg-highlight",
        // Capture mode: enable group hover
        isCaptureMode && "group"
      )}
    >
      {CaptureHideButton}
      <div className="max-w-4xl mx-auto">
        {/* Compact message header */}
        <MessageHeader message={message} />

        {/* 메시지 내용 */}
        <div className="w-full">
          {/* Message Content */}
          <MessageContentDisplay
            content={extractClaudeMessageContent(message)}
            messageType={message.type}
            searchQuery={searchQuery}
            isCurrentMatch={isCurrentMatch}
            currentMatchIndex={currentMatchIndex}
          />

          {/* Claude API Content Array */}
          {message.content &&
            typeof message.content === "object" &&
            Array.isArray(message.content) &&
            (message.type !== "assistant" ||
              (message.type === "assistant" &&
                !extractClaudeMessageContent(message))) && (
              <div className="mb-2">
                <ClaudeContentArrayRenderer
                  content={message.content}
                  searchQuery={searchQuery}
                  filterType={filterType}
                  isCurrentMatch={isCurrentMatch}
                  currentMatchIndex={currentMatchIndex}
                  skipToolResults={!!message.toolUseResult}
                />
              </div>
            )}

          {/* Tool Use */}
          {message.toolUse && (
            <ClaudeToolUseDisplay toolUse={message.toolUse} />
          )}

          {/* Tool Result */}
          {message.toolUseResult && (
            <ToolExecutionResultRouter
              toolResult={message.toolUseResult}
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
