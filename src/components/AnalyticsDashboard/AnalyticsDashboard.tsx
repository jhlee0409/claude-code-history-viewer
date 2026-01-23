"use client";

/**
 * AnalyticsDashboard Component
 *
 * Main analytics dashboard with project, session, and global views.
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading";
import { useAppStore } from "../../store/useAppStore";
import { useAnalytics } from "../../hooks/useAnalytics";
import type { AnalyticsDashboardProps } from "./types";
import { ProjectStatsView, SessionStatsView, GlobalStatsView } from "./views";

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  isViewingGlobalStats = false,
}) => {
  const { t } = useTranslation();
  const {
    selectedProject,
    selectedSession,
    sessionTokenStats,
    globalSummary,
    isLoadingGlobalStats,
  } = useAppStore();

  const { state: analyticsState } = useAnalytics();
  const [activeTab, setActiveTab] = useState<"project" | "session">("project");

  const projectSummary = analyticsState.projectSummary;
  const sessionComparison = analyticsState.sessionComparison;
  const sessionStats = sessionTokenStats;

  // Effects
  useEffect(() => {
    if (selectedSession && sessionStats && sessionComparison) {
      setActiveTab("session");
    } else {
      setActiveTab("project");
    }
  }, [selectedSession, sessionStats, sessionComparison]);

  useEffect(() => {
    setActiveTab("project");
  }, [selectedProject?.name]);

  // ============================================
  // MAIN RENDER
  // ============================================
  if (isViewingGlobalStats || !selectedProject) {
    if (isLoadingGlobalStats) {
      return (
        <div className="flex-1 p-6 flex items-center justify-center bg-background">
          <LoadingState
            isLoading={true}
            loadingMessage={t("analytics.loadingGlobalStats")}
            loadingSubMessage={t("analytics.loadingGlobalStatsDescription")}
            spinnerSize="xl"
            withSparkle={true}
          />
        </div>
      );
    }

    if (globalSummary) {
      return <GlobalStatsView globalSummary={globalSummary} />;
    }

    return (
      <div className="flex-1 p-6 flex items-center justify-center bg-background">
        <LoadingState
          isLoading={false}
          isEmpty={true}
          emptyComponent={
            <div className="text-center space-y-4">
              <div className="relative">
                <BarChart3 className="w-14 h-14 mx-auto text-muted-foreground/30" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--metric-purple)_/_0.1,_transparent_70%)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-1">
                  {t("analytics.Analytics Dashboard")}
                </h2>
                <p className="text-[12px] text-muted-foreground">
                  {t("analytics.Select a project to view analytics")}
                </p>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  const hasSessionData = selectedSession && sessionStats && sessionComparison;

  return (
    <div className="flex-1 p-6 overflow-auto bg-background">
      {/* Tab Selector */}
      {hasSessionData && (
        <div className="inline-flex p-1 mb-6 rounded-lg bg-muted/80 border border-border">
          <button
            onClick={() => setActiveTab("project")}
            className={cn(
              "px-4 py-2 rounded-md text-[12px] font-semibold transition-all duration-200",
              activeTab === "project"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-foreground/70 hover:text-foreground hover:bg-muted"
            )}
          >
            {t("analytics.projectOverview")}
          </button>
          <button
            onClick={() => setActiveTab("session")}
            className={cn(
              "px-4 py-2 rounded-md text-[12px] font-semibold transition-all duration-200",
              activeTab === "session"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-foreground/70 hover:text-foreground hover:bg-muted"
            )}
          >
            {t("analytics.sessionDetails")}
          </button>
        </div>
      )}

      {hasSessionData && activeTab === "session" ? (
        <SessionStatsView
          sessionStats={sessionStats}
          sessionComparison={sessionComparison}
          totalProjectSessions={projectSummary?.total_sessions}
        />
      ) : (
        <ProjectStatsView projectSummary={projectSummary} />
      )}
    </div>
  );
};

AnalyticsDashboard.displayName = "AnalyticsDashboard";
