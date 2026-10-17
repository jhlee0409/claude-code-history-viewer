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
import { FolderSearch, MessageSquare, Search } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import { Button } from "@/components/ui/button";
import { useProviderDiscovery } from "@/hooks/useProviderDiscovery";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { selectTokenStats } from "@/navigation/screenOwner";
import { MessageViewer } from "@/components/MessageViewer";
import { TokenStatsViewer } from "@/components/TokenStatsViewer";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { AnalyticsSubTabs } from "@/components/AnalyticsDashboard/AnalyticsSubTabs";
import {
  ANALYTICS_SUBTAB_PANEL_ID,
  analyticsSubTabId,
} from "@/components/AnalyticsDashboard/analyticsSubTabIds";
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
  /** The phone layout: analytics' sub-tabs live in the nav row above the screen. */
  isMobile: boolean;
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
 * No projects at all: says what was searched and where, instead of asking
 * for a session the user cannot pick. Until the user has asked for other
 * providers, only Claude Code was searched (startup never scans the rest),
 * so the screen says "no Claude Code projects" and offers the same "Find
 * other providers" action as the project tree.
 */
const NoProjectsState = () => {
  const { t } = useTranslation();
  const claudePath = useAppStore((s) => s.claudePath);
  const { discover, isDiscovering, hasSearched } = useProviderDiscovery();
  const copy = hasSearched
    ? {
        title: t("session.noProjects.title"),
        description: t("session.noProjects.description"),
        hint: "session.noProjects.hint" as const,
      }
    : {
        title: t("session.noProjects.claudeTitle"),
        description: t("session.noProjects.claudeDescription"),
        hint: "session.noProjects.claudeHint" as const,
      };
  return (
    // Korean breaks between words (keep-all), not inside them; Japanese and
    // Chinese have no spaces and keep the default per-character breaks.
    <EmptyState icon={FolderSearch} title={copy.title} className="px-4 [&:lang(ko)]:break-keep">
      <p className="text-body text-muted-foreground">{copy.description}</p>
      <code className="mt-2 mb-3 inline-block max-w-full break-all rounded-md bg-muted px-2 py-1 text-code text-foreground/80">
        {claudePath || "~/.claude"}
      </code>
      <p className="text-list text-muted-foreground">
        {t(copy.hint, {
          settings: t("settingsManager.title"),
          section: t("settings.customDirectories"),
        })}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={discover}
        disabled={isDiscovering}
      >
        <Icon icon={Search} size={14} aria-hidden="true" />
        {isDiscovering
          ? t("project.discoveringProviders")
          : t("project.discoverProviders")}
      </Button>
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
    (s) =>
      !s.isLoading &&
      !s.isLoadingProjects &&
      !s.isDetectingProviders &&
      s.projects.length === 0
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

/**
 * Project analytics and global stats: one body, so a switch keeps the
 * dashboard mounted. Project analytics has two sub-tabs (T9b): the overview
 * dashboard and the token statistics, which were a screen of their own. The
 * selected one is the place's (`analyticsTab`); choosing one navigates. On
 * phones the sub-tabs are items of the one analytics nav row above the screen
 * (`MobileAnalyticsSubNav`, with Edits), so the body draws no tablist there.
 */
export const AnalyticsScreen = ({ view, analyticsActions, onTokenStatClick, isMobile }: ViewScreenProps) => {
  const analyticsTab = useAppStore((s) => s.analyticsTab);
  const isProjectAnalytics = view === "analytics";
  const hasSubTabs = isProjectAnalytics && !isMobile;
  const showsTokens = isProjectAnalytics && analyticsTab === "tokens";
  return (
    <>
      {hasSubTabs && (
        <AnalyticsSubTabs
          value={analyticsTab}
          onChange={(tab) => {
            // The sub-tab's loader records its failure on screen (its error
            // state); the log keeps the cause.
            analyticsActions.switchToAnalytics(tab).catch((error: unknown) => {
              console.error("Failed to open the analytics sub-tab:", error);
            });
          }}
        />
      )}
      {/* The same element on both screens, so the dashboard stays mounted. */}
      <div
        id={hasSubTabs ? ANALYTICS_SUBTAB_PANEL_ID : undefined}
        role={hasSubTabs ? "tabpanel" : undefined}
        aria-labelledby={hasSubTabs ? analyticsSubTabId(analyticsTab) : undefined}
      >
        {showsTokens ? (
          <TokenStatsPanel onTokenStatClick={onTokenStatClick} />
        ) : (
          <AnalyticsDashboard
            isGlobalScope={view === "globalStats"}
            onRetry={() => void analyticsActions.refreshAnalytics()}
          />
        )}
      </div>
    </>
  );
};

/** The analytics "tokens" sub-tab: the project's and session's token statistics. */
const TokenStatsPanel = ({ onTokenStatClick }: Pick<ViewScreenProps, "onTokenStatClick">) => {
  const selectedProject = useAppStore((s) => s.selectedProject);
  // Only the open place's stats (`navigation/screenOwner.ts`).
  const stats = useAppStore(useShallow(selectTokenStats));
  const loadMoreProjectTokenStats = useAppStore((s) => s.loadMoreProjectTokenStats);
  const dateFilter = useAppStore((s) => s.dateFilter);
  const setDateFilter = useAppStore((s) => s.setDateFilter);

  return (
    <div className="p-3 md:p-6">
      <TokenStatsViewer
        sessionStats={stats.sessionStats}
        sessionConversationStats={stats.sessionConversationStats}
        projectStats={stats.projectStats}
        projectConversationStats={stats.projectConversationStats}
        projectStatsSummary={stats.projectStatsSummary}
        projectConversationStatsSummary={stats.projectConversationStatsSummary}
        providerId={selectedProject?.provider ?? "claude"}
        pagination={stats.pagination}
        onLoadMore={() => selectedProject && loadMoreProjectTokenStats(selectedProject.path)}
        isLoading={stats.isLoading}
        error={stats.error}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        onSessionClick={onTokenStatClick}
      />
    </div>
  );
};

/**
 * The Edits screen: the one recent-edits surface (T9b). It reads its rows
 * from the store itself, keyed by the request they answer
 * (`navigation/screenOwner.ts`).
 */
export const RecentEditsScreen = ({ analyticsState }: ViewScreenProps) => (
  <RecentEditsViewer initialSearchQuery={analyticsState.recentEditsSearchQuery} />
);

export const BoardScreen = () => <SessionBoard />;

export const ArchiveScreen = () => <ArchiveManager className="flex-1 min-h-0" />;

/** Takes the kept project as its context (plan §4.1). */
export const SettingsScreen = () => {
  const projectPath = useAppStore((s) => s.selectedProject?.actual_path);
  return <SettingsManager projectPath={projectPath} className="flex-1 min-h-0" />;
};
