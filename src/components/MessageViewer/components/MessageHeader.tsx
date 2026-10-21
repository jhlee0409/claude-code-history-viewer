/**
 * MessageHeader Component
 *
 * Displays message metadata (role, timestamp, model info, usage stats).
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { CircleQuestionMark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { getShortModelName } from "../../../utils/model";
import { ModelLifecycleBadge } from "@/components/ModelLifecycleBadge";
import { getToolName } from "../../../utils/toolUtils";
import { hasSystemCommandContent } from "../helpers/messageHelpers";
import type { MessageHeaderProps } from "../types";
import type { ClaudeAssistantMessage } from "../../../types";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

export const MessageHeader: React.FC<MessageHeaderProps> = ({ message }) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleTooltipToggle = useCallback(() => {
    setIsTooltipOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isTooltipOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setIsTooltipOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isTooltipOpen]);
  const isToolResultMessage =
    (message.type === "user" || message.type === "assistant") &&
    !!message.toolUseResult;
  const isSystemContent = hasSystemCommandContent(message);
  const toolName = isToolResultMessage
    ? getToolName(
      (message as ClaudeAssistantMessage).toolUse,
      (message as ClaudeAssistantMessage).toolUseResult
    )
    : null;
  const isLeftAligned =
    message.type !== "user" || isToolResultMessage || isSystemContent;

  return (
    <div className={cn(
      "flex items-center mb-1 text-list text-muted-foreground",
      isLeftAligned ? "justify-between" : "justify-end"
    )}>
      <div className="flex items-center gap-1.5">
        <span className="font-medium">
          {isToolResultMessage && toolName
            ? toolName
            : isSystemContent
              ? t("messageViewer.system")
              : message.type === "user"
                ? t("messageViewer.user")
                : message.type === "assistant"
                  ? (message.provider && message.provider !== "claude"
                    ? t(`common.provider.${message.provider}`, message.provider)
                    : t("messageViewer.claude"))
                  : t("messageViewer.system")}
        </span>
        <span>·</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="cursor-default">
              <Num>{fmt.time(message.timestamp)}</Num>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            <Num>{fmt.dateTimeFull(message.timestamp)}</Num>
          </TooltipContent>
        </Tooltip>
        {message.isSidechain && (
          <span className="px-1.5 py-0.5 text-list font-mono bg-warning/20 text-warning rounded-full">
            {t("messageViewer.branch")}
          </span>
        )}
      </div>

      {message.type === "assistant" && message.model && (
        <div ref={tooltipRef} className="relative group flex items-center gap-1.5">
          <span className="text-muted-foreground">{getShortModelName(message.model)}</span>
          <ModelLifecycleBadge model={message.model} compact />
          {message.usage && (
            <>
              <button
                type="button"
                onClick={handleTooltipToggle}
                className="inline-flex items-center justify-center cursor-help text-muted-foreground"
                aria-label={t("assistantMessageDetails.model")}
              >
                <CircleQuestionMark className="w-3.5 h-3.5" />
              </button>
              <div className={cn(
                "absolute bottom-full mb-2 right-0 w-52 bg-popover text-popover-foreground",
                "text-list rounded-md p-2.5",
                "transition-opacity shadow-lg z-10 border border-border",
                isTooltipOpen ? "opacity-100 pointer-events-auto" : "opacity-0 group-hover:opacity-100 pointer-events-none"
              )}>
                <p className="mb-1"><strong>{t("assistantMessageDetails.model")}:</strong> {message.model}</p>
                <p className="mb-1"><strong>{t("messageViewer.time")}:</strong> <Num>{fmt.dateTimeFull(message.timestamp)}</Num></p>
                {message.usage.input_tokens && <p>{t("assistantMessageDetails.input")}: <Num>{fmt.count(message.usage.input_tokens)}</Num></p>}
                {message.usage.output_tokens && <p>{t("assistantMessageDetails.output")}: <Num>{fmt.count(message.usage.output_tokens)}</Num></p>}
                {message.usage.cache_creation_input_tokens ? <p>{t("assistantMessageDetails.cacheCreation")}: <Num>{fmt.count(message.usage.cache_creation_input_tokens)}</Num></p> : null}
                {message.usage.cache_read_input_tokens ? <p>{t("assistantMessageDetails.cacheRead")}: <Num>{fmt.count(message.usage.cache_read_input_tokens)}</Num></p> : null}
                {typeof message.usage.reasoning_tokens === "number" ? <p>{t("analytics.reasoning", "Reasoning")}: <Num>{fmt.count(message.usage.reasoning_tokens)}</Num></p> : null}
                <div className="absolute right-4 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-popover"></div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

MessageHeader.displayName = "MessageHeader";
