import React from "react";
import { MessageCircle, Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionHeaderProps } from "../types";

export const SessionHeader: React.FC<SessionHeaderProps> = ({
  isArchivedCodexSession,
  isSelected,
}) => {
  const { t } = useTranslation();

  if (isArchivedCodexSession) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            aria-label={t("session.item.archived", "Archived session")}
            title={t("session.item.archived", "Archived session")}
            className={cn(
              "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-300",
              isSelected
                ? "bg-amber-500/20 text-amber-300"
                : "bg-amber-500/10 text-amber-500"
            )}
          >
            <Archive className="w-3 h-3" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium">Archived session</p>
          <p className="text-[11px] text-primary-foreground/80 mt-1 leading-relaxed">
            Stored under Codex `archived_sessions`.
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-300",
        isSelected
          ? "bg-accent text-accent-foreground"
          : "bg-muted/50 text-muted-foreground"
      )}
    >
      <span title={t("session.item.session")}>
        <MessageCircle className="w-3 h-3" />
      </span>
    </div>
  );
};
