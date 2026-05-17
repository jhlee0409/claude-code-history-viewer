import {
  Loader2,
  RefreshCw,
  BarChart3,
  MessageSquare,
  Activity,
  FileEdit,
  Terminal,
  SlidersHorizontal,
  Columns,
  Search,
  Archive,
} from "lucide-react";

import { TooltipButton } from "@/shared/TooltipButton";
import { useAppStore } from "@/store/useAppStore";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";
import { useModal } from "@/contexts/modal";

import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { isMacOS, isTauri } from "@/utils/platform";
import { SettingDropdown } from "./SettingDropdown";

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
    isLoadingMessages,
    refreshCurrentSession,
  } = useAppStore();

  const computed = analyticsComputed;
  const isClaudeProject = (selectedProject?.provider ?? "claude") === "claude";

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
      <div className="relative z-10 flex items-center gap-2.5 min-w-0 pointer-events-none">
        <img
          src="/app-icon.png"
          alt="Claude Code History"
          className="w-6 h-6 hidden md:block"
        />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold text-foreground hidden md:block">
              {t('common.appName')}
            </h1>
            {selectedProject && (
              <>
                <span className="text-muted-foreground/40 hidden md:block">/</span>
                <span className="text-sm text-muted-foreground truncate max-w-[180px]">
                  {selectedProject.name}
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
            <p className="text-2xs text-muted-foreground truncate max-w-[280px] md:max-w-sm">
              <span className="text-muted-foreground/60 hidden md:inline">Session:</span>{" "}
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
        <div className="relative z-10 hidden lg:flex items-center gap-2 pointer-events-none">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-2xs text-muted-foreground font-mono">
            {selectedSession.actual_session_id.slice(0, 8)}
          </span>
        </div>
      )}

      {/* Right: Actions */}
      <div className="relative z-10 flex items-center gap-1">
        {/* Search button with shortcut hint */}
        <button
          onClick={() => openModal("globalSearch")}
          className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/50 text-xs"
          aria-label={t("common.commandPalette")}
        >
          <Search className="w-3.5 h-3.5" />
          <span>{t("globalSearch.placeholder")}</span>
          <kbd className="ml-1 px-1 py-0.5 text-[10px] font-mono bg-muted rounded border border-border">
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

        {/* Desktop nav buttons */}
        <div className="hidden md:flex items-center gap-1">
          {selectedProject && (
            <>
              {/* Analytics */}
              <NavButton
                icon={computed.isLoadingAnalytics ? Loader2 : BarChart3}
                label={t("analytics.dashboard")}
                isActive={computed.isAnalyticsView}
                isLoading={computed.isLoadingAnalytics}
                onClick={() => {
                  if (computed.isAnalyticsView) {
                    analyticsActions.switchToMessages();
                  } else {
                    handleLoadAnalytics();
                  }
                }}
                disabled={computed.isLoadingAnalytics}
              />

              {/* Token Stats */}
              <NavButton
                icon={computed.isLoadingTokenStats ? Loader2 : Activity}
                label={t('messages.tokenStats.existing')}
                isActive={computed.isTokenStatsView}
                isLoading={computed.isLoadingTokenStats}
                onClick={() => {
                  if (computed.isTokenStatsView) {
                    analyticsActions.switchToMessages();
                  } else {
                    handleLoadTokenStats();
                  }
                }}
                disabled={computed.isLoadingTokenStats}
              />

              {/* Recent Edits */}
              <NavButton
                icon={computed.isLoadingRecentEdits ? Loader2 : FileEdit}
                label={t("recentEdits.title")}
                isActive={computed.isRecentEditsView}
                isLoading={computed.isLoadingRecentEdits}
                onClick={() => {
                  if (computed.isRecentEditsView) {
                    analyticsActions.switchToMessages();
                  } else {
                    handleLoadRecentEdits();
                  }
                }}
                disabled={computed.isLoadingRecentEdits}
              />

              {/* Session Board */}
              <NavButton
                icon={Columns}
                label={
                  isClaudeProject
                    ? t("session.board.title")
                    : `${t("session.board.title")} (Claude only)`
                }
                isActive={computed.isBoardView}
                disabled={!isClaudeProject}
                onClick={() => {
                  if (computed.isBoardView) {
                    analyticsActions.switchToMessages();
                  } else {
                    handleLoadBoard();
                  }
                }}
              />
            </>
          )}

          {selectedSession && (
            <>
              {/* Divider */}
              <div className="w-px h-6 bg-border mx-2" />

              {/* Messages */}
              <NavButton
                icon={MessageSquare}
                label={t("message.view")}
                isActive={computed.isMessagesView}
                onClick={() => {
                  if (!computed.isMessagesView) {
                    analyticsActions.switchToMessages();
                  }
                }}
              />

              {/* Refresh */}
              <TooltipButton
                onClick={() => refreshCurrentSession()}
                disabled={isLoadingMessages}
                className={cn(
                  "p-2 rounded-md transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                content={t("session.refresh")}
              >
                <RefreshCw
                  className={cn("w-4 h-4", isLoadingMessages && "animate-spin")}
                />
              </TooltipButton>
            </>
          )}

          {/* Archive Manager */}
          <NavButton
            icon={Archive}
            label={
              isClaudeProject
                ? t("archive.title")
                : `${t("archive.title")} (Claude only)`
            }
            isActive={computed.isArchiveView}
            disabled={!isClaudeProject}
            onClick={() => {
              if (computed.isArchiveView) {
                analyticsActions.switchToMessages();
              } else {
                analyticsActions.switchToArchive();
              }
            }}
          />

          {/* Settings Manager */}
          <NavButton
            icon={SlidersHorizontal}
            label={t("settingsManager.title")}
            isActive={computed.isSettingsView}
            onClick={() => {
              if (computed.isSettingsView) {
                analyticsActions.switchToMessages();
              } else {
                analyticsActions.switchToSettings();
              }
            }}
          />
        </div>

        {/* Settings Dropdown (visible on all sizes) */}
        <SettingDropdown updater={updater} />
      </div>
    </header>
  );
};

/* Navigation Button Component */
interface NavButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  isLoading?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const NavButton = ({
  icon: Icon,
  label,
  isActive,
  isLoading,
  onClick,
  disabled,
}: NavButtonProps) => {
  return (
    <TooltipButton
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-2 rounded-md transition-colors",
        "text-muted-foreground",
        isActive
          ? "bg-accent/10 text-accent"
          : "hover:bg-muted hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      content={label}
    >
      <Icon className={cn("w-4 h-4", isLoading && "animate-spin")} />
    </TooltipButton>
  );
};
