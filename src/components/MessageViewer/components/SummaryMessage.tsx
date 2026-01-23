/**
 * SummaryMessage Component
 *
 * Collapsible summary message display for prior context.
 */

import React, { useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatTimeShort } from "../../../utils/time";
import type { SummaryMessageProps } from "../types";

export const SummaryMessage: React.FC<SummaryMessageProps> = ({ content, timestamp }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { t } = useTranslation();

  return (
    <div className="rounded-md border mx-4 my-2 bg-info/10 border-info/30">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-1.5 px-3 py-2 h-8",
          "text-left hover:bg-info/20 transition-colors rounded-md"
        )}
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 transition-transform flex-shrink-0 text-info",
            isExpanded && "rotate-90"
          )}
        />
        <FileText className="w-4 h-4 flex-shrink-0 text-info" />
        <span className="text-sm font-medium text-info-foreground">
          {t("messageViewer.priorContext")}
        </span>
        <span className="text-xs ml-auto text-info">
          {formatTimeShort(timestamp)}
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 text-sm text-info-foreground">
          {content}
        </div>
      )}
    </div>
  );
};

SummaryMessage.displayName = "SummaryMessage";
