import React from "react";
import { Clock, Hash, Wrench, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { SessionMetaProps } from "../types";

export const SessionMeta: React.FC<SessionMetaProps> = ({
  session,
  isSelected,
  formatTimeAgo,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 ml-7 text-2xs">
      <span
        className={cn(
          "flex items-center gap-1 font-mono",
          isSelected ? "text-accent/80" : "text-muted-foreground"
        )}
      >
        <span title={t("session.item.lastModified")}>
          <Clock className="w-3 h-3" />
        </span>
        {formatTimeAgo(session.last_modified)}
      </span>
      <span
        className={cn(
          "flex items-center gap-1 font-mono",
          isSelected ? "text-accent/80" : "text-muted-foreground"
        )}
      >
        <span title={t("session.item.messageCount")}>
          <Hash className="w-3 h-3" />
        </span>
        {session.message_count}
      </span>
      {session.has_tool_use && (
        <span title={t("session.item.containsToolUse")}>
          <Wrench
            className={cn(
              "w-3 h-3",
              isSelected ? "text-accent" : "text-accent/50"
            )}
          />
        </span>
      )}
      {session.has_errors && (
        <span title={t("session.item.containsErrors")}>
          <AlertTriangle className="w-3 h-3 text-destructive" />
        </span>
      )}
    </div>
  );
};
