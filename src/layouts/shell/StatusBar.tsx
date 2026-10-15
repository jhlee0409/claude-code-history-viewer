/**
 * The status bar along the bottom (desktop only): version, counts, and what
 * is loading right now.
 */
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading";
import { useAppStore } from "@/store/useAppStore";

interface StatusBarProps {
  isDesktop: boolean;
  appVersion: string;
  projectCount: number;
  sessionCount: number;
  /** Messages in the open transcript; null when no transcript is shown. */
  messageCount: number | null;
  isLoading: boolean;
  isLoadingProjects: boolean;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingStats: boolean;
}

export const StatusBar = ({
  isDesktop,
  appVersion,
  projectCount,
  sessionCount,
  messageCount,
  isLoading,
  isLoadingProjects,
  isLoadingSessions,
  isLoadingMessages,
  isLoadingStats,
}: StatusBarProps) => {
  const { t } = useTranslation();
  // The loaded window may be partial under message pagination: "+" says so.
  const hasMoreMessages = useAppStore((s) => s.pagination.hasMore);

  // The first load in progress names the status, in this precedence.
  const loadingLabel = (
    [
      [isLoading, "status.initializing"],
      [isLoadingProjects, "status.scanning"],
      [isLoadingSessions, "status.loadingSessions"],
      [isLoadingMessages, "status.loadingMessages"],
      [isLoadingStats, "status.loadingStats"],
    ] as const
  ).find(([active]) => active)?.[1];

  return (
    <footer className="h-7 px-4 hidden md:flex items-center justify-between bg-sidebar border-t border-border/50 text-caption text-muted-foreground">
      <div className="flex items-center gap-3 font-mono tabular-nums">
        <span>
          {isDesktop
            ? t("status.versionLabel", "v{{version}}", {
                version: appVersion,
              })
            : t("status.webMode", "Web")}
        </span>
        <span className="text-border">&bull;</span>
        <span>{t("project.count", { count: projectCount })}</span>
        <span className="text-border">&bull;</span>
        <span>{t("session.count", { count: sessionCount })}</span>
        {messageCount !== null && (
          <>
            <span className="text-border">&bull;</span>
            <span>
              {t("message.count", { count: messageCount })}
              {hasMoreMessages ? "+" : ""}
            </span>
          </>
        )}
      </div>

      {loadingLabel && (
        <div className="flex items-center gap-1.5">
          <LoadingSpinner size="xs" variant="muted" />
          <span>{t(loadingLabel)}</span>
        </div>
      )}
    </footer>
  );
};
