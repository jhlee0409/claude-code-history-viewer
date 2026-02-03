// src/components/ProjectTree/components/SessionList.tsx
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionItem } from "../../SessionItem";
import type { SessionListProps } from "../types";

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  selectedSession,
  isLoading,
  onSessionSelect,
  onSessionHover,
  formatTimeAgo,
  variant = "default",
}) => {
  const { t } = useTranslation();

  const isWorktree = variant === "worktree";
  const isMain = variant === "main";
  const borderClass = isWorktree
    ? "border-l border-emerald-500/30"
    : isMain
      ? "border-l border-accent/30"
      : "border-l-2 border-accent/20";

  const containerClass = isWorktree || isMain ? "ml-4 pl-2" : "ml-6 pl-3";

  if (isLoading) {
    return (
      <div className={cn(containerClass, borderClass, "space-y-2 py-2")}>
        {[1, 2, isWorktree || isMain ? 0 : 3].filter(Boolean).map((i) => (
          <div key={i} className="flex items-center gap-2.5 py-2 px-3">
            <Skeleton variant="circular" className="w-5 h-5" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={cn(containerClass, "py-2 text-2xs text-muted-foreground", isWorktree || isMain ? "ml-5" : "ml-7")}>
        {t("components:session.notFound", "No sessions")}
      </div>
    );
  }

  return (
    <div className={cn(containerClass, borderClass, "space-y-1 py-2", (isWorktree || isMain) && "py-1.5")}>
      {sessions.map((session) => (
        <SessionItem
          key={session.session_id}
          session={session}
          isSelected={selectedSession?.session_id === session.session_id}
          onSelect={() => onSessionSelect(session)}
          onHover={() => onSessionHover?.(session)}
          formatTimeAgo={formatTimeAgo}
        />
      ))}
    </div>
  );
};
