import { useMemo } from "react";
import type { BoardSessionData } from "../../types/board.types";
import type { DateFilter } from "../../types/board.types";

export interface WeeklyGridCell {
  date: string;
  dayOfWeek: number;
  weekIndex: number;
  sessionCount: number;
  totalTokens: number;
  intensity: number;
  isInCurrentFilter: boolean;
}

export interface MonthLabel {
  label: string;
  weekIndex: number;
}

export interface ActivityData {
  weeklyGrid: WeeklyGridCell[][];
  monthLabels: MonthLabel[];
  totalActiveDays: number;
  currentStreak: number;
  longestStreak: number;
  totalSessions: number;
  maxSessionsPerDay: number;
}

interface DailyBucket {
  sessionCount: number;
  totalTokens: number;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  return new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}

function getSundayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function computeStreaks(dailyMap: Map<string, DailyBucket>): { current: number; longest: number } {
  if (dailyMap.size === 0) return { current: 0, longest: 0 };

  const sortedDates = Array.from(dailyMap.keys())
    .filter(d => (dailyMap.get(d)?.sessionCount ?? 0) > 0)
    .sort();

  if (sortedDates.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let currentRun = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prevStr = sortedDates[i - 1];
    const currStr = sortedDates[i];
    if (!prevStr || !currStr) continue;
    const prev = parseDate(prevStr);
    const curr = parseDate(currStr);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      currentRun++;
      longest = Math.max(longest, currentRun);
    } else {
      currentRun = 1;
    }
  }

  // Current streak: check if the last active day is today or yesterday
  const today = toDateString(new Date());
  const yesterday = toDateString(addDays(new Date(), -1));
  const lastActiveDate = sortedDates[sortedDates.length - 1] ?? "";

  let currentStreak = 0;
  if (lastActiveDate === today || lastActiveDate === yesterday) {
    currentStreak = 1;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
      const prevStr = sortedDates[i];
      const currStr = sortedDates[i + 1];
      if (!prevStr || !currStr) break;
      const prev = parseDate(prevStr);
      const curr = parseDate(currStr);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  return { current: currentStreak, longest };
}

export function useActivityData(
  boardSessions: Record<string, BoardSessionData>,
  allSortedSessionIds: string[],
  dateFilter: DateFilter
): ActivityData {
  return useMemo(() => {
    if (allSortedSessionIds.length === 0) {
      return {
        weeklyGrid: [],
        monthLabels: [],
        totalActiveDays: 0,
        currentStreak: 0,
        longestStreak: 0,
        totalSessions: 0,
        maxSessionsPerDay: 0,
      };
    }

    // Step 1: Aggregate sessions by date
    const dailyMap = new Map<string, DailyBucket>();

    for (const id of allSortedSessionIds) {
      const data = boardSessions[id];
      if (!data) continue;

      const timeStr = data.session.last_message_time || data.session.last_modified;
      if (!timeStr) continue;

      const date = toDateString(new Date(timeStr));
      const existing = dailyMap.get(date) || { sessionCount: 0, totalTokens: 0 };
      existing.sessionCount += 1;
      existing.totalTokens += data.stats.totalTokens;
      dailyMap.set(date, existing);
    }

    // Step 2: Determine date range
    const allDates = Array.from(dailyMap.keys()).sort();
    const firstDate = allDates[0];
    const lastDate = allDates[allDates.length - 1];
    if (!firstDate || !lastDate) {
      return { weeklyGrid: [], monthLabels: [], totalActiveDays: 0, currentStreak: 0, longestStreak: 0, totalSessions: 0, maxSessionsPerDay: 0 };
    }
    const minDate = parseDate(firstDate);
    const maxDate = parseDate(lastDate);

    // Pad to complete weeks (Sun-Sat)
    const gridStart = getSundayOfWeek(minDate);
    const gridEndDate = new Date(maxDate);
    gridEndDate.setDate(gridEndDate.getDate() + (6 - gridEndDate.getDay())); // Extend to Saturday

    // Step 3: Build weekly grid
    const weeklyGrid: WeeklyGridCell[][] = [];
    const monthLabels: MonthLabel[] = [];

    let maxCount = 0;
    for (const bucket of dailyMap.values()) {
      maxCount = Math.max(maxCount, bucket.sessionCount);
    }

    // DateFilter range for highlight
    const filterStartMs = dateFilter?.start ? dateFilter.start.getTime() : 0;
    const filterEndMs = dateFilter?.end
      ? dateFilter.end.getTime() + 24 * 60 * 60 * 1000
      : Infinity;
    const hasFilter = dateFilter?.start != null || dateFilter?.end != null;

    let currentDate = new Date(gridStart);
    let weekIndex = 0;
    let lastMonthLabel = -1;

    while (currentDate <= gridEndDate) {
      const week: WeeklyGridCell[] = [];

      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const dateStr = toDateString(currentDate);
        const bucket = dailyMap.get(dateStr);
        const sessionCount = bucket?.sessionCount ?? 0;
        const totalTokens = bucket?.totalTokens ?? 0;

        const cellMs = currentDate.getTime();
        const isInCurrentFilter = hasFilter
          ? cellMs >= filterStartMs && cellMs < filterEndMs
          : false;

        week.push({
          date: dateStr,
          dayOfWeek,
          weekIndex,
          sessionCount,
          totalTokens,
          intensity: maxCount > 0 ? sessionCount / maxCount : 0,
          isInCurrentFilter,
        });

        // Month label: first occurrence of a new month at the start of a week
        if (dayOfWeek === 0 && currentDate.getMonth() !== lastMonthLabel) {
          // Only add label if we're at or past the 1st of the month
          if (currentDate.getDate() <= 7) {
            monthLabels.push({
              label: MONTH_NAMES[currentDate.getMonth()] ?? "",
              weekIndex,
            });
            lastMonthLabel = currentDate.getMonth();
          }
        }

        currentDate = addDays(currentDate, 1);
      }

      weeklyGrid.push(week);
      weekIndex++;
    }

    // Step 4: Compute stats
    const { current: currentStreak, longest: longestStreak } = computeStreaks(dailyMap);
    const totalActiveDays = Array.from(dailyMap.values()).filter(b => b.sessionCount > 0).length;

    return {
      weeklyGrid,
      monthLabels,
      totalActiveDays,
      currentStreak,
      longestStreak,
      totalSessions: allSortedSessionIds.length,
      maxSessionsPerDay: maxCount,
    };
  }, [boardSessions, allSortedSessionIds, dateFilter]);
}
