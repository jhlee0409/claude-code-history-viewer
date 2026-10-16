/**
 * The main-area body of each screen, as the view registry renders it.
 *
 * Each screen reads what it shows from the store itself; the shell passes only
 * what lives above the store (the analytics hook's state and actions, App's
 * token-stat click handler). The frame a body sits in (overlay scroll, padded
 * column, or none) belongs to the registry entry, not to the screen, so
 * screens that share a frame keep one frame instance across a switch, as the
 * hand-written branches did.
 */
import type { ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useTranslation } from "react-i18next";
import { FolderSearch, MessageSquare } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { MessageViewer } from "@/components/MessageViewer";
import { TokenStatsViewer } from "@/components/TokenStatsViewer";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { RecentEditsViewer } from "@/components/RecentEditsViewer";
import { SettingsManager } from "@/components/SettingsManager";
import { SessionBoard } from "@/components/SessionBoard/SessionBoard";
import { ArchiveManager } from "@/components/ArchiveManager";
import type { SessionTokenStats } from "@/types";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { View } from "@/navigation/place";

/** What the shell hands every screen. */
export interface ViewScreenProps {
  /** The screen being shown; lets one body serve two registry entries. */
  view: View;
  analyticsState: UseAnalyticsReturn["state"];
  analyticsActions: UseAnalyticsReturn["actions"];
  onTokenStatClick: (stats: SessionTokenStats) => void;
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

const SCROLL_OPTIONS = {
  scrollbars: {
    theme: "os-theme-custom",
    autoHide: "leave",
  },
} as const;

/** Full-height overlay scroll area. */
export const ScrollFrame = ({ children }: { children: ReactNode }) => (
  <OverlayScrollbarsComponent className="h-full" options={SCROLL_OPTIONS}>
    {children}
  </OverlayScrollbarsComponent>
);

/** Full-height padded column for the app-level managers. */
export const PaddedFrame = ({ children }: { children: ReactNode }) => (
  <div className="h-full flex flex-col p-3 md:p-6">{children}</div>
);

/** No frame: the screen lays itself out. */
export const BareFrame = ({ children }: { children: ReactNode }) => <>{children}</>;

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/** Centered icon + title + body, the shape of every empty main area. */
const EmptyState = ({
  icon,
  title,
  children,
  className,
}: {
  icon: typeof MessageSquare;
  title: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className="h-full flex">
    <div className="flex-1 flex items-center justify-center">
      <div className={cn("text-center max-w-sm mx-auto", className)}>
        <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-6">
          <Icon icon={icon} size={24} className="text-muted-foreground/50" />
        </div>
        <h3 className="text-title font-medium text-foreground mb-2">{title}</h3>
        {children}
      </div>
    </div>
  </div>
);

/**
 * No history at all: says so (in the sidebar's words) and where the app
 * looked, instead of asking for a session the user cannot pick.
 */
const NoProjectsState = () => {
  const { t } = useTranslation();
  const claudePath = useAppStore((s) => s.claudePath);
  return (
    <EmptyState icon={FolderSearch} title={t("session.noProjects.title")} className="px-4">
      <p className="text-body text-muted-foreground">{t("session.noProjects.description")}</p>
      <code className="mt-2 mb-3 inline-block max-w-full break-all rounded-md bg-muted px-2 py-1 text-code text-foreground/80">
        {claudePath || "~/.claude"}
      </code>
      <p className="text-list text-muted-foreground">
        {t("session.noProjects.hint", {
          settings: t("settingsManager.title"),
          section: t("settings.customDirectories"),
        })}
      </p>
    </EmptyState>
  );
};

/**
 * The empty screen, and a conversation without a session: "select a
 * session", or - once loading is over and there are no projects at all -
 * the no-history state.
 */
export const EmptyScreen = () => {
  const { t } = useTranslation();
  const hasNoProjects = useAppStore(
    (s) => !s.isLoading && !s.isLoadingProjects && s.projects.length === 0
  );
  if (hasNoProjects) return <NoProjectsState />;
  return (
    <EmptyState icon={MessageSquare} title={t("session.select")}>
      <p className="text-body text-muted-foreground">{t("session.selectDescription")}</p>
    </EmptyState>
  );
};

/**
 * The transcript. Renders the empty screen until a session is open (the
 * transitional form of `empty`, plan §4.1, until documents arrive in T8).
 */
export const ConversationScreen = ({ analyticsActions }: ViewScreenProps) => {
  const selectedSession = useAppStore((s) => s.selectedSession);
  const messages = useAppStore((s) => s.messages);
  const isLoading = useAppStore((s) => s.isLoading);
  const sessionSearch = useAppStore((s) => s.sessionSearch);
  const setSessionSearchQuery = useAppStore((s) => s.setSessionSearchQuery);
  const setSearchFilterType = useAppStore((s) => s.setSearchFilterType);
  const clearSessionSearch = useAppStore((s) => s.clearSessionSearch);
  const goToNextMatch = useAppStore((s) => s.goToNextMatch);
  const goToPrevMatch = useAppStore((s) => s.goToPrevMatch);

  if (!selectedSession) return <EmptyScreen />;
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-x-hidden">
        <MessageViewer
          messages={messages}
          isLoading={isLoading}
          selectedSession={selectedSession}
          sessionSearch={sessionSearch}
          onSearchChange={setSessionSearchQuery}
          onFilterTypeChange={setSearchFilterType}
          onClearSearch={clearSessionSearch}
          onNextMatch={goToNextMatch}
          onPrevMatch={goToPrevMatch}
          onBack={() => analyticsActions.switchToBoard()}
        />
      </div>
    </div>
  );
};

/** Project analytics and global stats: one body, so a switch keeps it mounted. */
export const AnalyticsScreen = ({ view, analyticsActions }: ViewScreenProps) => (
  <AnalyticsDashboard
    isGlobalScope={view === "globalStats"}
    onRetry={() => void analyticsActions.refreshAnalytics()}
  />
);

/** Transitional (plan C1) until token stats becomes an analytics tab (T9b). */
export const TokenStatsScreen = ({ onTokenStatClick }: ViewScreenProps) => {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const sessionTokenStats = useAppStore((s) => s.sessionTokenStats);
  const sessionConversationTokenStats = useAppStore((s) => s.sessionConversationTokenStats);
  const projectTokenStats = useAppStore((s) => s.projectTokenStats);
  const projectConversationTokenStats = useAppStore((s) => s.projectConversationTokenStats);
  const projectTokenStatsSummary = useAppStore((s) => s.projectTokenStatsSummary);
  const projectConversationTokenStatsSummary = useAppStore(
    (s) => s.projectConversationTokenStatsSummary
  );
  const projectTokenStatsPagination = useAppStore((s) => s.projectTokenStatsPagination);
  const loadMoreProjectTokenStats = useAppStore((s) => s.loadMoreProjectTokenStats);
  const isLoadingTokenStats = useAppStore((s) => s.isLoadingTokenStats);
  const dateFilter = useAppStore((s) => s.dateFilter);
  const setDateFilter = useAppStore((s) => s.setDateFilter);

  return (
    <div className="p-3 md:p-6">
      <TokenStatsViewer
        sessionStats={sessionTokenStats}
        sessionConversationStats={sessionConversationTokenStats}
        projectStats={projectTokenStats}
        projectConversationStats={projectConversationTokenStats}
        projectStatsSummary={projectTokenStatsSummary}
        projectConversationStatsSummary={projectConversationTokenStatsSummary}
        providerId={selectedProject?.provider ?? "claude"}
        pagination={projectTokenStatsPagination}
        onLoadMore={() => selectedProject && loadMoreProjectTokenStats(selectedProject.path)}
        isLoading={isLoadingTokenStats}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        onSessionClick={onTokenStatClick}
      />
    </div>
  );
};

export const RecentEditsScreen = ({ analyticsState }: ViewScreenProps) => {
  const selectedProject = useAppStore((s) => s.selectedProject);
  const loadMoreRecentEdits = useAppStore((s) => s.loadMoreRecentEdits);
  return (
    <RecentEditsViewer
      recentEdits={analyticsState.recentEdits}
      pagination={analyticsState.recentEditsPagination}
      onLoadMore={() => selectedProject && loadMoreRecentEdits(selectedProject.path)}
      isLoading={analyticsState.isLoadingRecentEdits}
      error={analyticsState.recentEditsError}
      initialSearchQuery={analyticsState.recentEditsSearchQuery}
    />
  );
};

export const BoardScreen = () => <SessionBoard />;

export const ArchiveScreen = () => <ArchiveManager className="flex-1 min-h-0" />;

/** Takes the kept project as its context (plan §4.1). */
export const SettingsScreen = () => {
  const projectPath = useAppStore((s) => s.selectedProject?.actual_path);
  return <SettingsManager projectPath={projectPath} className="flex-1 min-h-0" />;
};
