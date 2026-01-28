import {
  Loader2,
  RefreshCw,
  BarChart3,
  MessageSquare,
  Activity,
  FileEdit,
  Terminal,
  SlidersHorizontal,
} from "lucide-react";

import { TooltipButton } from "@/shared/TooltipButton";
import { useAppStore } from "@/store/useAppStore";
import { useAnalytics } from "@/hooks/useAnalytics";

import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { SettingDropdown } from "./SettingDropdown";

export const Header = () => {
  const { t } = useTranslation();
    
  const {
    selectedProject,
    selectedSession,
    isLoadingMessages,
    refreshCurrentSession,
  } = useAppStore();

  const { actions: analyticsActions, computed } = useAnalytics();

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

  return (
    <header className="h-12 flex items-center justify-between px-4 bg-sidebar border-b border-border/50">

      {/* Left: Logo & Title */}
      <div className="flex items-center gap-2.5">
        <img
          src="/app-icon.png"
          alt="Claude Code History"
          className="w-6 h-6"
        />
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-foreground">
              {t('common.appName')}
            </h1>
            {selectedProject && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-sm text-muted-foreground truncate max-w-[180px]">
                  {selectedProject.name}
                </span>
              </>
            )}
          </div>
          {selectedSession ? (
            <p className="text-2xs text-muted-foreground truncate max-w-sm">
              <span className="text-muted-foreground/60">Session:</span>{" "}
              {selectedSession.summary ||
                `${t("session.title")} ${selectedSession.session_id.slice(-8)}`}
            </p>
          ) : (
            <p className="text-2xs text-muted-foreground">{t('common.appDescription')}</p>
          )}
        </div>
      </div>

      {/* Center: Quick Stats (when session selected) */}
      {selectedSession && computed.isMessagesView && (
        <div className="hidden lg:flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-2xs text-muted-foreground font-mono">
            {selectedSession.actual_session_id.slice(0, 8)}
          </span>
        </div>
      )}

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
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

        {/* Settings Dropdown */}
        <SettingDropdown />
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
