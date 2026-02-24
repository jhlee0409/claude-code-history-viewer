/**
 * useActivityData Hook Tests
 * 
 * Tests for the activity timeline data aggregation hook, covering:
 * - DST boundaries
 * - Month transitions
 * - Single-day filters
 * - Empty data
 * - Streak calculations
 * - Weekly grid padding
 */

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActivityData } from "../components/SessionBoard/useActivityData";
import type { BoardSessionData } from "../types/board.types";
import type { DateFilter } from "../types/board.types";

// Helper to create mock session data
function createMockSession(
  id: string,
  lastMessageTime: string,
  totalTokens: number = 100
): BoardSessionData {
  return {
    session: {
      id,
      title: `Session ${id}`,
      last_message_time: lastMessageTime,
      last_modified: lastMessageTime,
      metadata: {},
    },
    stats: {
      totalTokens,
      inputTokens: totalTokens / 2,
      outputTokens: totalTokens / 2,
      messageCount: 1,
    },
  } as BoardSessionData;
}

describe("useActivityData", () => {
  describe("empty data handling", () => {
    it("should return empty data structure when no sessions", () => {
      const { result } = renderHook(() =>
        useActivityData({}, [], { start: null, end: null })
      );

      expect(result.current.weeklyGrid).toEqual([]);
      expect(result.current.monthLabels).toEqual([]);
      expect(result.current.dailyBars).toEqual([]);
      expect(result.current.totalActiveDays).toBe(0);
      expect(result.current.currentStreak).toBe(0);
      expect(result.current.longestStreak).toBe(0);
      expect(result.current.totalSessions).toBe(0);
      expect(result.current.maxSessionsPerDay).toBe(0);
    });

    it("should handle sessions without timestamps", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": {
          session: {
            id: "1",
            title: "Session 1",
            last_message_time: "",
            last_modified: "",
            metadata: {},
          },
          stats: {
            totalTokens: 100,
            inputTokens: 50,
            outputTokens: 50,
            messageCount: 1,
          },
        } as BoardSessionData,
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1"], { start: null, end: null })
      );

      // Sessions without valid timestamps should result in empty data
      expect(result.current.totalActiveDays).toBe(0);
      expect(result.current.totalSessions).toBe(0);
    });
  });

  describe("daily aggregation", () => {
    it("should aggregate multiple sessions on same day", () => {
      // Use local-time strings (no Z suffix) so toDateString() always
      // resolves to the same local date regardless of the runner's timezone.
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00", 100),
        "2": createMockSession("2", "2024-01-15T14:00:00", 150),
        "3": createMockSession("3", "2024-01-15T18:00:00", 200),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      expect(result.current.totalActiveDays).toBe(1);
      expect(result.current.totalSessions).toBe(3);
      expect(result.current.maxSessionsPerDay).toBe(3);
      
      const dailyBar = result.current.dailyBars[0];
      expect(dailyBar?.sessionCount).toBe(3);
      expect(dailyBar?.totalTokens).toBe(450);
    });

    it("should separate sessions on different days", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00", 100),
        "2": createMockSession("2", "2024-01-16T10:00:00", 150),
        "3": createMockSession("3", "2024-01-17T10:00:00", 200),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      expect(result.current.totalActiveDays).toBe(3);
      expect(result.current.dailyBars).toHaveLength(3);
      expect(result.current.maxSessionsPerDay).toBe(1);
    });
  });

  describe("streak calculations", () => {
    it("should calculate consecutive day streaks", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-17T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      expect(result.current.longestStreak).toBe(3);
    });

    it("should break streak on gap day", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-18T10:00:00"), // Gap: Jan 17 missing
        "4": createMockSession("4", "2024-01-19T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3", "4"], { start: null, end: null })
      );

      expect(result.current.longestStreak).toBe(2);
    });

    it("should calculate current streak ending today", () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", twoDaysAgo.toISOString()),
        "2": createMockSession("2", yesterday.toISOString()),
        "3": createMockSession("3", today.toISOString()),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      expect(result.current.currentStreak).toBe(3);
    });

    it("should calculate current streak ending yesterday", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", twoDaysAgo.toISOString()),
        "2": createMockSession("2", yesterday.toISOString()),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], { start: null, end: null })
      );

      expect(result.current.currentStreak).toBe(2);
    });

    it("should reset current streak if last activity is older", () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", fourDaysAgo.toISOString()),
        "2": createMockSession("2", threeDaysAgo.toISOString()),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], { start: null, end: null })
      );

      expect(result.current.currentStreak).toBe(0);
    });
  });

  describe("weekly grid generation", () => {
    it("should pad to complete weeks (Sunday-Saturday)", () => {
      // Create sessions for a single week
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"), // Monday
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1"], { start: null, end: null })
      );

      expect(result.current.weeklyGrid.length).toBeGreaterThan(0);
      const firstWeek = result.current.weeklyGrid[0];
      expect(firstWeek).toHaveLength(7); // Should have 7 days

      // Check that we have Sunday (day 0) through Saturday (day 6)
      expect(firstWeek?.[0]?.dayOfWeek).toBe(0); // Sunday
      expect(firstWeek?.[6]?.dayOfWeek).toBe(6); // Saturday
    });

    it("should handle month transitions in grid", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-30T10:00:00"), // End of January
        "2": createMockSession("2", "2024-02-01T10:00:00"), // Start of February
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], { start: null, end: null })
      );

      expect(result.current.totalActiveDays).toBe(2);
      
      // Month labels are only added at week starts when the date is <= 7th of month
      // With only 3 days range, we may not have month labels depending on week alignment
      // This test verifies the grid contains both dates regardless
      const allDates = result.current.weeklyGrid.flat().map(c => c.date);
      expect(allDates).toContain("2024-01-30");
      expect(allDates).toContain("2024-02-01");
    });

    it("should calculate correct intensity values", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-16T14:00:00"), // 2 sessions on this day
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      // Find cells with sessions
      const cells = result.current.weeklyGrid.flat().filter(c => c.sessionCount > 0);
      
      const cellWith1Session = cells.find(c => c.sessionCount === 1);
      const cellWith2Sessions = cells.find(c => c.sessionCount === 2);
      
      expect(cellWith1Session?.intensity).toBe(0.5); // 1/2
      expect(cellWith2Sessions?.intensity).toBe(1.0); // 2/2 (max)
    });
  });

  describe("date filter highlighting", () => {
    it("should highlight single day filter", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-17T10:00:00"),
      };

      const filterDate = new Date("2024-01-16T00:00:00");
      const dateFilter: DateFilter = {
        start: filterDate,
        end: filterDate,
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], dateFilter)
      );

      const highlightedCells = result.current.weeklyGrid
        .flat()
        .filter(c => c.isInCurrentFilter);

      // Only Jan 16 should be highlighted
      expect(highlightedCells).toHaveLength(1);
      expect(highlightedCells[0]?.date).toBe("2024-01-16");
    });

    it("should highlight date range filter", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-17T10:00:00"),
      };

      const dateFilter: DateFilter = {
        start: new Date("2024-01-15T00:00:00"),
        end: new Date("2024-01-16T00:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], dateFilter)
      );

      const highlightedCells = result.current.weeklyGrid
        .flat()
        .filter(c => c.isInCurrentFilter);

      // Jan 15 and Jan 16 should be highlighted
      expect(highlightedCells.length).toBe(2);
      expect(highlightedCells.map(c => c.date).sort()).toEqual(["2024-01-15", "2024-01-16"]);
    });

    it("should handle end time with time component correctly", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
      };

      const dateFilter: DateFilter = {
        start: new Date("2024-01-15T00:00:00"),
        // End with time component (not midnight)
        end: new Date("2024-01-15T23:59:59.999"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], dateFilter)
      );

      const highlightedCells = result.current.weeklyGrid
        .flat()
        .filter(c => c.isInCurrentFilter);

      // Only Jan 15 should be highlighted (end time has component, so add 1ms not 24h)
      expect(highlightedCells).toHaveLength(1);
      expect(highlightedCells[0]?.date).toBe("2024-01-15");
    });

    it("should not highlight when no filter is set", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1"], { start: null, end: null })
      );

      const highlightedCells = result.current.weeklyGrid
        .flat()
        .filter(c => c.isInCurrentFilter);

      expect(highlightedCells).toHaveLength(0);
    });
  });

  describe("DST boundary handling", () => {
    it("should handle DST spring forward (2024-03-10 in US)", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-03-09T10:00:00"),
        "2": createMockSession("2", "2024-03-10T10:00:00"), // DST boundary
        "3": createMockSession("3", "2024-03-11T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      // Should still treat as 3 consecutive days
      expect(result.current.longestStreak).toBe(3);
      expect(result.current.totalActiveDays).toBe(3);
    });

    it("should handle DST fall back (2024-11-03 in US)", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-11-02T10:00:00"),
        "2": createMockSession("2", "2024-11-03T10:00:00"), // DST boundary
        "3": createMockSession("3", "2024-11-04T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      // Should still treat as 3 consecutive days
      expect(result.current.longestStreak).toBe(3);
      expect(result.current.totalActiveDays).toBe(3);
    });
  });

  describe("month label placement", () => {
    it("should add month label when month starts within first week", () => {
      // Use a date range that definitely spans multiple weeks and includes month start
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-28T10:00:00"), // Last week of Jan
        "2": createMockSession("2", "2024-02-01T10:00:00"), // Feb 1st
        "3": createMockSession("3", "2024-02-04T10:00:00"), // First Sun of Feb (week start)
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      // Month labels are generated when:
      // 1. It's a Sunday (dayOfWeek === 0)
      // 2. It's a new month
      // 3. The date is <= 7 (first week of month)
      const monthLabels = result.current.monthLabels;
      expect(monthLabels.length).toBeGreaterThan(0);
      expect(monthLabels[0]).toHaveProperty("label");
      expect(monthLabels[0]).toHaveProperty("weekIndex");
    });

    it("should not duplicate month labels", () => {
      // Create sessions spanning two months
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-28T10:00:00"),
        "2": createMockSession("2", "2024-02-04T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], { start: null, end: null })
      );

      const monthLabels = result.current.monthLabels.map(m => m.label);
      const uniqueLabels = new Set(monthLabels);
      
      // Each month should only appear once
      expect(monthLabels.length).toBe(uniqueLabels.size);
    });
  });

  describe("dailyBars output", () => {
    it("should sort dailyBars by date", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-17T10:00:00"),
        "2": createMockSession("2", "2024-01-15T10:00:00"),
        "3": createMockSession("3", "2024-01-16T10:00:00"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      const dates = result.current.dailyBars.map(b => b.date);
      expect(dates).toEqual(["2024-01-15", "2024-01-16", "2024-01-17"]);
    });

    it("should include all data in dailyBars", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00", 100),
        "2": createMockSession("2", "2024-01-15T14:00:00", 200),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], { start: null, end: null })
      );

      const bar = result.current.dailyBars[0];
      expect(bar?.date).toBe("2024-01-15");
      expect(bar?.sessionCount).toBe(2);
      expect(bar?.totalTokens).toBe(300);
    });
  });

  describe("filtered stats with dateFilter", () => {
    it("should filter totalActiveDays and totalSessions by dateFilter range", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00", 100),
        "2": createMockSession("2", "2024-01-16T10:00:00", 150),
        "3": createMockSession("3", "2024-01-17T10:00:00", 200),
      };

      const dateFilter: DateFilter = {
        start: new Date("2024-01-16T00:00:00"),
        end: new Date("2024-01-16T23:59:59.999"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], dateFilter)
      );

      // Only Jan 16 is in the filter range
      expect(result.current.totalActiveDays).toBe(1);
      expect(result.current.totalSessions).toBe(1);
    });

    it("should filter streak calculations by dateFilter range", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-17T10:00:00"),
        "4": createMockSession("4", "2024-01-19T10:00:00"), // gap
        "5": createMockSession("5", "2024-01-20T10:00:00"),
      };

      // Filter to only Jan 15-17 (3 consecutive days)
      const dateFilter: DateFilter = {
        start: new Date("2024-01-15T00:00:00"),
        end: new Date("2024-01-17T23:59:59.999"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3", "4", "5"], dateFilter)
      );

      expect(result.current.longestStreak).toBe(3);
      expect(result.current.totalActiveDays).toBe(3);
      expect(result.current.totalSessions).toBe(3);
    });

    it("should return zero stats when dateFilter excludes all sessions", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
      };

      // Filter to a date with no sessions
      const dateFilter: DateFilter = {
        start: new Date("2024-02-01T00:00:00"),
        end: new Date("2024-02-01T23:59:59.999"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2"], dateFilter)
      );

      expect(result.current.totalActiveDays).toBe(0);
      expect(result.current.totalSessions).toBe(0);
      expect(result.current.currentStreak).toBe(0);
      expect(result.current.longestStreak).toBe(0);
    });

    it("should show full stats when dateFilter is cleared", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00", 100),
        "2": createMockSession("2", "2024-01-16T10:00:00", 200),
        "3": createMockSession("3", "2024-01-17T10:00:00", 300),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], { start: null, end: null })
      );

      expect(result.current.totalActiveDays).toBe(3);
      expect(result.current.totalSessions).toBe(3);
    });

    it("should keep grid data unfiltered even with dateFilter", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00", 100),
        "2": createMockSession("2", "2024-01-16T10:00:00", 200),
        "3": createMockSession("3", "2024-01-17T10:00:00", 300),
      };

      const dateFilter: DateFilter = {
        start: new Date("2024-01-16T00:00:00"),
        end: new Date("2024-01-16T23:59:59.999"),
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], dateFilter)
      );

      // Grid should still contain all 3 days
      const activeCells = result.current.weeklyGrid
        .flat()
        .filter(c => c.sessionCount > 0);
      expect(activeCells).toHaveLength(3);

      // dailyBars should still have all 3 days
      expect(result.current.dailyBars).toHaveLength(3);

      // maxSessionsPerDay should be based on full data
      expect(result.current.maxSessionsPerDay).toBe(1);

      // But stats should be filtered
      expect(result.current.totalActiveDays).toBe(1);
      expect(result.current.totalSessions).toBe(1);
    });

    it("should handle start-only dateFilter", () => {
      const sessions: Record<string, BoardSessionData> = {
        "1": createMockSession("1", "2024-01-15T10:00:00"),
        "2": createMockSession("2", "2024-01-16T10:00:00"),
        "3": createMockSession("3", "2024-01-17T10:00:00"),
      };

      const dateFilter: DateFilter = {
        start: new Date("2024-01-16T00:00:00"),
        end: null,
      };

      const { result } = renderHook(() =>
        useActivityData(sessions, ["1", "2", "3"], dateFilter)
      );

      // Jan 16 and 17 should be included
      expect(result.current.totalActiveDays).toBe(2);
      expect(result.current.totalSessions).toBe(2);
    });
  });
});
