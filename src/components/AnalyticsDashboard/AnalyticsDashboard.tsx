"use client";

/**
 * AnalyticsDashboard Component
 *
 * Clean analytics dashboard with tab selector.
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Layers, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/ui/loading";
import { useAppStore } from "../../store/useAppStore";
import type { AnalyticsDashboardProps } from "./types";
import { ProjectStatsView, SessionStatsView, GlobalStatsView } from "./views";
import { DatePickerHeader } from "../ui/DatePickerHeader";

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
    dateFilter,
    setDateFilter,
    analytics: analyticsState,
  } = useAppStore();
  const [activeTab, setActiveTab] = useState<"project" | "session">("project");

  const projectSummary = analyticsState.projectSummary;
  const sessionComparison = analyticsState.sessionComparison;
  const sessionStats = sessionTokenStats;

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

  // Global stats or no project
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
              <div className="w-16 h-16 mx-auto rounded-full bg-muted/30 flex items-center justify-center">
                <BarChart3 className="w-8 h-8 text-muted-foreground/40" />
              </div>
              <div>
                <h2 className="text-sm font-medium text-foreground/80 mb-1">
                  {t("analytics.Analytics Dashboard")}
                </h2>
                <p className="text-xs text-muted-foreground">
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
      <div className="relative">
        {/* Header Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          {/* Tab Selector */}
          {hasSessionData && (
            <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg w-fit">
              <button
                onClick={() => setActiveTab("project")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-[11px] font-medium rounded-md transition-all duration-200",
                  activeTab === "project"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Layers
                  className={cn(
                    "w-3.5 h-3.5",
                    activeTab === "project" ? "text-metric-purple" : "text-muted-foreground/60"
                  )}
                />
                {t("analytics.projectOverview")}
              </button>
              <button
                onClick={() => setActiveTab("session")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-[11px] font-medium rounded-md transition-all duration-200",
                  activeTab === "session"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Activity
                  className={cn(
                    "w-3.5 h-3.5",
                    activeTab === "session" ? "text-metric-green" : "text-muted-foreground/60"
                  )}
                />
                {t("analytics.sessionDetails")}
              </button>
            </div>
          )}

          {/* Global Date Picker */}
          <div className="flex items-center gap-2">
            <DatePickerHeader
              dateFilter={dateFilter}
              setDateFilter={setDateFilter}
              className="bg-card/50"
            />
          </div>
        </div>

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
    </div>
  );
};

AnalyticsDashboard.displayName = "AnalyticsDashboard";
