import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Flame, Calendar, X } from "lucide-react";
import { ContributionGrid } from "./ContributionGrid";
import { useActivityData } from "./useActivityData";
import type { BoardSessionData } from "../../types/board.types";
import type { DateFilter } from "../../types/board.types";

interface SessionActivityTimelineProps {
  boardSessions: Record<string, BoardSessionData>;
  allSortedSessionIds: string[];
  dateFilter: DateFilter;
  setDateFilter: (filter: DateFilter) => void;
  clearDateFilter: () => void;
  isExpanded: boolean;
  onToggle: () => void;
  projectName?: string;
}

export const SessionActivityTimeline: React.FC<SessionActivityTimelineProps> = ({
  boardSessions,
  allSortedSessionIds,
  dateFilter,
  setDateFilter,
  clearDateFilter,
  isExpanded,
  onToggle,
  projectName,
}) => {
  const { t } = useTranslation();
  const activityData = useActivityData(boardSessions, allSortedSessionIds, dateFilter);

  // Determine if a single date is selected (heatmap-originated filter)
  const selectedDate = useMemo(() => {
    if (!dateFilter?.start || !dateFilter?.end) return null;
    const startStr = dateFilter.start.toISOString().split("T")[0];
    const endStr = dateFilter.end.toISOString().split("T")[0];
    if (startStr === endStr) return startStr ?? null;
    return null;
  }, [dateFilter]);

  const handleDateClick = useCallback(
    (date: string) => {
      const d = new Date(date + "T00:00:00");
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      setDateFilter({ start, end });
    },
    [setDateFilter]
  );

  const handleDateClear = useCallback(() => {
    clearDateFilter();
  }, [clearDateFilter]);

  if (allSortedSessionIds.length === 0) return null;

  const { totalActiveDays, currentStreak, longestStreak, totalSessions } = activityData;

  return (
    <div className="border-b border-border/50 bg-card/20 shrink-0">
      {/* Header / Collapsed view */}
      <button
        onClick={onToggle}
        className="w-full h-8 px-3 flex items-center gap-2 text-xs hover:bg-muted/30 transition-colors"
        aria-expanded={isExpanded}
        aria-label={t("analytics.timeline.title")}
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}

        <span className="text-[11px] font-medium text-foreground/80 truncate">
          {projectName ?? t("analytics.timeline.title")}
        </span>

        <div className="flex items-center gap-3 ml-auto text-[10px] text-muted-foreground shrink-0">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {totalActiveDays} {t("analytics.timeline.activeDays")}
          </span>
          {currentStreak > 0 && (
            <span className="flex items-center gap-1 text-orange-500/80">
              <Flame className="w-3 h-3" />
              {currentStreak} {t("analytics.timeline.currentStreak")}
            </span>
          )}
          <span>
            {totalSessions} {t("analytics.timeline.sessions", { count: totalSessions })}
          </span>
        </div>
      </button>

      {/* Expanded view */}
      {isExpanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {/* Stats row */}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>
              {t("analytics.timeline.longestStreak")}: {longestStreak}{" "}
              {t("analytics.timeline.days", { count: longestStreak })}
            </span>
            {selectedDate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDateClear();
                }}
                className="flex items-center gap-0.5 text-primary/70 hover:text-primary transition-colors"
              >
                <X className="w-3 h-3" />
                {t("analytics.timeline.clearFilter")}
              </button>
            )}
          </div>

          {/* Contribution Grid */}
          <ContributionGrid
            weeklyGrid={activityData.weeklyGrid}
            monthLabels={activityData.monthLabels}
            onDateClick={handleDateClick}
            onDateClear={handleDateClear}
            selectedDate={selectedDate}
          />
        </div>
      )}
    </div>
  );
};

SessionActivityTimeline.displayName = "SessionActivityTimeline";
