import React from "react";
import { Clock, Hash, Wrench, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  normalizeEntrypoint,
  ENTRYPOINT_BADGE_META,
} from "@/utils/entrypoint";
import type { SessionMetaProps } from "../types";

export const SessionMeta: React.FC<SessionMetaProps> = ({
  session,
  isSelected,
  formatTimeAgo,
}) => {
  const { t } = useTranslation();

  // Originating client badge (CLI / VS Code / Desktop). Unknown or missing
  // entrypoint values normalize to null and render nothing.
  const entrypointCategory = normalizeEntrypoint(session.entrypoint);
  const entrypointMeta = entrypointCategory
    ? ENTRYPOINT_BADGE_META[entrypointCategory]
    : null;

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
      {session.storage_type && (
        <span
          className={cn(
            "px-1 py-0.5 rounded font-medium uppercase",
            isSelected
              ? "text-accent/80 bg-accent/10"
              : "text-muted-foreground bg-muted/50"
          )}
        >
          {t(`session.item.storageType.${session.storage_type}`)}
        </span>
      )}
      {entrypointMeta && (
        <span
          className={cn(
            "px-1 py-0.5 rounded font-medium",
            isSelected ? "text-accent/80 bg-accent/10" : entrypointMeta.badgeClass
          )}
          title={t(entrypointMeta.i18nKey)}
        >
          {t(entrypointMeta.i18nKey)}
        </span>
      )}
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
