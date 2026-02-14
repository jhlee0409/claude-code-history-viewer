import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { getHeatColor } from "../AnalyticsDashboard/utils/calculations";
import type { WeeklyGridCell, MonthLabel } from "./useActivityData";

interface ContributionGridProps {
  weeklyGrid: WeeklyGridCell[][];
  monthLabels: MonthLabel[];
  onDateClick: (date: string) => void;
  onDateClear: () => void;
  selectedDate: string | null;
}

const CELL_SIZE = 13;
const CELL_GAP = 2;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

export const ContributionGrid: React.FC<ContributionGridProps> = ({
  weeklyGrid,
  monthLabels,
  onDateClick,
  onDateClear,
  selectedDate,
}) => {
  const { t } = useTranslation();

  const dayLabelWidth = 28;

  const cellStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    for (const week of weeklyGrid) {
      for (const cell of week) {
        const key = `${cell.weekIndex}-${cell.dayOfWeek}`;
        styles[key] = {
          backgroundColor: getHeatColor(cell.intensity),
        };
      }
    }
    return styles;
  }, [weeklyGrid]);

  if (weeklyGrid.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-2 text-center">
        {t("analytics.timeline.noActivity")}
      </div>
    );
  }

  const handleCellClick = (date: string) => {
    if (selectedDate === date) {
      onDateClear();
    } else {
      onDateClick(date);
    }
  };

  const handleCellKeyDown = (e: React.KeyboardEvent, date: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCellClick(date);
    }
  };

  const formatDateLabel = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Grid */}
      <div className="overflow-x-auto scrollbar-thin">
        <div className="inline-flex flex-col" style={{ minWidth: "fit-content" }}>
          {/* Month labels row */}
          <div className="flex" style={{ paddingLeft: `${dayLabelWidth}px` }}>
            {weeklyGrid.map((_, weekIdx) => {
              const label = monthLabels.find((m) => m.weekIndex === weekIdx);
              return (
                <div
                  key={weekIdx}
                  className="text-[9px] text-muted-foreground font-medium"
                  style={{
                    width: `${CELL_SIZE + CELL_GAP}px`,
                    textAlign: "left",
                  }}
                >
                  {label?.label ?? ""}
                </div>
              );
            })}
          </div>

          {/* Day rows */}
          {[0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => (
            <div key={dayOfWeek} className="flex items-center">
              {/* Day label */}
              <div
                className="text-[9px] text-muted-foreground font-medium shrink-0"
                style={{ width: `${dayLabelWidth}px` }}
              >
                {DAY_LABELS[dayOfWeek] ?? ""}
              </div>

              {/* Week cells */}
              <div className="flex" style={{ gap: `${CELL_GAP}px` }}>
                {weeklyGrid.map((week) => {
                  const cell = week[dayOfWeek];
                  if (!cell) return null;
                  const key = `${cell.weekIndex}-${cell.dayOfWeek}`;
                  const isSelected = selectedDate === cell.date;
                  const isFiltered = cell.isInCurrentFilter;

                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`${formatDateLabel(cell.date)}: ${cell.sessionCount} ${cell.sessionCount === 1 ? t("analytics.timeline.session", { count: cell.sessionCount }) : t("analytics.timeline.sessions", { count: cell.sessionCount })}`}
                          className={`
                            rounded-sm cursor-pointer transition-all duration-100
                            hover:scale-125 hover:z-10
                            ${isSelected ? "ring-2 ring-primary" : ""}
                            ${isFiltered && !isSelected ? "ring-1 ring-primary/40" : ""}
                            ${cell.intensity > 0 ? "hover:ring-1 hover:ring-white/30" : ""}
                          `}
                          style={{
                            width: `${CELL_SIZE}px`,
                            height: `${CELL_SIZE}px`,
                            ...cellStyles[key],
                          }}
                          onClick={() => handleCellClick(cell.date)}
                          onKeyDown={(e) => handleCellKeyDown(e, cell.date)}
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="font-mono text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-semibold text-[11px]">
                            {formatDateLabel(cell.date)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {cell.sessionCount > 0
                              ? t("analytics.timeline.sessions", { count: cell.sessionCount })
                              : t("analytics.timeline.noActivity")}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <span className="text-[9px] font-medium text-muted-foreground">
          {t("analytics.timeline.less")}
        </span>
        <div className="flex gap-0.5">
          {[0, 0.25, 0.5, 0.75, 1].map((intensity) => (
            <div
              key={intensity}
              className="rounded-sm"
              style={{
                width: `${CELL_SIZE - 2}px`,
                height: `${CELL_SIZE - 2}px`,
                backgroundColor: getHeatColor(intensity),
              }}
            />
          ))}
        </div>
        <span className="text-[9px] font-medium text-muted-foreground">
          {t("analytics.timeline.more")}
        </span>
      </div>
    </div>
  );
};

ContributionGrid.displayName = "ContributionGrid";
