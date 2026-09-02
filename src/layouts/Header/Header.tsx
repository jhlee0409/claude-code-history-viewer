import {
  Loader2,
  RefreshCw,
  BarChart3,
  MessageSquare,
  Activity,
  FileEdit,
  Columns,
  Search,
} from "lucide-react";

import { TooltipButton } from "@/shared/TooltipButton";
import { useAppStore } from "@/store/useAppStore";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import { useModal } from "@/contexts/modal";

import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { getAssetPath, isMacOS, isTauri } from "@/utils/platform";
import { SettingDropdown } from "./SettingDropdown";
import { getProjectDisplayName } from "@/utils/pathUtils";
import { SessionCopyMenu } from "./SessionCopyMenu";

interface HeaderProps {
  analyticsActions: UseAnalyticsReturn["actions"];
  analyticsComputed: UseAnalyticsReturn["computed"];
  updater: UseUpdaterReturn;
}

const SHORTCUT_LABEL = isMacOS() ? "⌘+K" : "Ctrl+K";

// macOS traffic-light buttons overlap the header in Tauri's Overlay
// titleBarStyle. Reserve space for them only when running in the desktop
// shell — the WebUI build has no overlay controls.
const HAS_MACOS_TRAFFIC_LIGHTS = isTauri() && isMacOS();

export const Header = ({ analyticsActions, analyticsComputed, updater }: HeaderProps) => {
  const { t } = useTranslation();
  const { openModal } = useModal();

  const {
    selectedProject,
    selectedSession,
    isLoadingProjects,
    isLoadingSessions,
    isLoadingMessages,
    isRefreshingAllConversations,
    refreshAllConversations,
    recentEditsMode,
    toggleRecentEditsDock,
    setRecentEditsDockOpen,
  } = useAppStore();

  const computed = analyticsComputed;
  const isClaudeProject = (selectedProject?.provider ?? "claude") === "claude";
  const isRefreshingConversations =
    isRefreshingAllConversations ||
    isLoadingProjects ||
    isLoadingSessions ||
    isLoadingMessages;

  const handleLoadTokenStats = async () => {
    if (!selectedProject) return;
    try {
      await analyticsActions.switchToTokenStats();
    } catch (error) {
      console.error("Failed to load token stats:", error);
    }
  };

  const handleLoadAnalytics = async () => {
    if (!selectedProject) return;
    try {
      await analyticsActions.switchToAnalytics();
    } catch (error) {
      console.error("Failed to load analytics:", error);
    }
  };

  const handleLoadRecentEdits = async () => {
    if (!selectedProject) return;

    // The button routes on mode. In "docked" mode it toggles the side panel
    // beside the transcript; in "page" mode it keeps today's behaviour of
    // taking over the content area.
    // The dock is CSS-gated at the `xl` breakpoint, so a docked-mode preference
    // carried over from a wide window (or restored on a narrow one) would
    // otherwise toggle state that nothing can render. Read the width at click
    // time rather than holding reactive state for it.
    const dockCanRender =
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1280px)").matches;

    if (recentEditsMode === "docked" && selectedSession && dockCanRender) {
      // The dock only renders inside the transcript branch of the layout, so
      // from any other view (Analytics, Board, Settings) a plain toggle just
      // flips invisible state and looks like a dead button. Go to the
      // transcript and open the dock instead of toggling it shut.
      if (!analyticsComputed.isMessagesView) {
        setRecentEditsDockOpen(true);
        analyticsActions.switchToMessages();
        return;
      }
      toggleRecentEditsDock();
      return;
    }

    try {
      await analyticsActions.switchToRecentEdits();
    } catch (error) {
      console.error("Failed to load recent edits:", error);
    }
  };

  const handleLoadBoard = async () => {
    if (!selectedProject) return;
    try {
      await analyticsActions.switchToBoard();
    } catch (error) {
      console.error("Failed to load board:", error);
      window.alert(t("session.board.error.loadBoard"));
    }
  };

  return (
    <header
      id="app-header"
      role="banner"
      className={cn(
        "relative h-12 flex items-center justify-between px-4 bg-sidebar border-b border-border/50",
        HAS_MACOS_TRAFFIC_LIGHTS && "pl-[72px]"
      )}
    >
      {/* Full-header drag region — sits behind all content so the
          entire header is draggable. Interactive children (right-side
          buttons) sit above with their own pointer events; non-interactive
          children (logo, title) use pointer-events-none so clicks fall
          through to this layer. */}
      <div data-tauri-drag-region className="absolute inset-0" />

      {/* Left: Logo & Title */}
      <div className="relative z-10 flex items-center gap-2.5 min-w-0 flex-1 pointer-events-none">
        <img
          src={getAssetPath("app-icon.png")}
          alt="Claude Code History"
          className="w-6 h-6 hidden md:block"
        />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold text-foreground hidden md:block shrink-0">
              {t('common.appName')}
            </h1>
            {selectedProject && (
              <>
                <span className="text-muted-foreground/40 hidden md:block">/</span>
                <span className="text-sm text-muted-foreground truncate min-w-0 pointer-events-auto" title={selectedProject.actual_path}>
                  {getProjectDisplayName(selectedProject)}
                </span>
              </>
            )}
            {!selectedProject && (
              <h1 className="text-sm font-semibold text-foreground md:hidden">
                {t('common.appName')}
              </h1>
            )}
          </div>
          {selectedSession ? (
            <p
              className="text-2xs text-muted-foreground truncate min-w-0 max-w-[60ch] pointer-events-auto"
              title={selectedSession.summary || undefined}
            >
              <span className="text-muted-foreground/60 hidden md:inline">{t("session.title")}</span>{" "}
              {selectedSession.summary ||
                `${t("session.title")} ${selectedSession.session_id.slice(-8)}`}
            </p>
          ) : (
            <p className="text-2xs text-muted-foreground hidden md:block">{t('common.appDescription')}</p>
          )}
        </div>
      </div>

      {/* Center: Quick Stats (when session selected) */}
      {selectedSession && computed.isMessagesView && (
        <div className="relative z-10 hidden lg:flex items-center gap-2">
          <SessionCopyMenu project={selectedProject} session={selectedSession} />
        </div>
      )}

      {/* Right: Actions */}
      <div className="relative z-10 flex items-center gap-1">
        {selectedSession && computed.isMessagesView && (
          <div className="lg:hidden">
            <SessionCopyMenu compact project={selectedProject} session={selectedSession} />
          </div>
        )}

        {/* Search button with shortcut hint */}
        <button
          onClick={() => openModal("globalSearch")}
          className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/50 text-xs"
          aria-label={t("common.commandPalette")}
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t("globalSearch.placeholder")}</span>
          <kbd className="ml-1 px-1 py-0.5 text-px10 font-mono bg-muted rounded border border-border">
            {SHORTCUT_LABEL}
          </kbd>
        </button>
        <button
          onClick={() => openModal("globalSearch")}
          className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={t("common.commandPalette")}
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Project views — one segmented control, Messages first so the way
            back from any analytics view is always visible. */}
        {selectedProject && (
          <div
            role="tablist"
            aria-label={t("header.views", "Views")}
            className="hidden md:flex items-center gap-0.5 bg-muted/60 rounded-lg p-0.5 border border-border/60"
          >
            <ViewTab
              icon={MessageSquare}
              label={t("message.view")}
              isActive={computed.isMessagesView}
              onClick={() => {
                if (!computed.isMessagesView) analyticsActions.switchToMessages();
              }}
            />
            <ViewTab
              icon={computed.isLoadingAnalytics ? Loader2 : BarChart3}
              label={t("analytics.dashboard")}
              isActive={computed.isAnalyticsView}
              isLoading={computed.isLoadingAnalytics}
              onClick={() => {
                if (!computed.isAnalyticsView) handleLoadAnalytics();
              }}
              disabled={computed.isLoadingAnalytics}
            />
            <ViewTab
              icon={computed.isLoadingTokenStats ? Loader2 : Activity}
              label={t("messages.tokenStats.existing")}
              isActive={computed.isTokenStatsView}
              isLoading={computed.isLoadingTokenStats}
              onClick={() => {
                if (!computed.isTokenStatsView) handleLoadTokenStats();
              }}
              disabled={computed.isLoadingTokenStats}
            />
            <ViewTab
              icon={computed.isLoadingRecentEdits ? Loader2 : FileEdit}
              label={t("recentEdits.title")}
              isActive={computed.isRecentEditsView}
              isLoading={computed.isLoadingRecentEdits}
              onClick={() => {
                if (computed.isRecentEditsView && recentEditsMode !== "docked") {
                  analyticsActions.switchToMessages();
                } else {
                  handleLoadRecentEdits();
                }
              }}
              disabled={computed.isLoadingRecentEdits}
            />
            <ViewTab
              icon={Columns}
              label={
                isClaudeProject
                  ? t("session.board.title")
                  : t("common.settings.claudeOnly", { name: t("session.board.title") })
              }
              isActive={computed.isBoardView}
              disabled={!isClaudeProject}
              onClick={() => {
                if (!computed.isBoardView) handleLoadBoard();
              }}
            />
          </div>
        )}

        {/* Refresh — rescans projects and reloads the selected session, so a
            second per-session refresh button is redundant. */}
        <TooltipButton
          onClick={() => {
            void refreshAllConversations();
          }}
          disabled={isRefreshingConversations}
          className={cn(
            "p-2 rounded-md transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            isRefreshingConversations && "opacity-70 cursor-not-allowed"
          )}
          content={t("session.refreshAllConversations", "Refresh all conversations")}
        >
          <RefreshCw className={cn("w-4 h-4", isRefreshingConversations && "animate-spin")} />
        </TooltipButton>

        {/* App menu: preferences plus the Claude Code tools (Settings
            Manager, Archive) that used to sit beside them as bare icons. */}
        <SettingDropdown
          updater={updater}
          onOpenSettingsManager={() => {
            if (!computed.isSettingsView) analyticsActions.switchToSettings();
          }}
          onOpenArchive={() => {
            if (!computed.isArchiveView) analyticsActions.switchToArchive();
          }}
          archiveDisabled={!isClaudeProject}
        />
      </div>
    </header>
  );
};

/* Segmented view tab: icon always, label from xl up. */
interface ViewTabProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  isLoading?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const ViewTab = ({ icon: Icon, label, isActive, isLoading, onClick, disabled }: ViewTabProps) => {
  return (
    <TooltipButton
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap",
        isActive
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      content={label}
    >
      <Icon className={cn("w-4 h-4", isLoading && "animate-spin")} />
      <span className="hidden xl:inline">{label}</span>
    </TooltipButton>
  );
};
