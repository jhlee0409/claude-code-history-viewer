import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTrendData } from "../components/AnalyticsDashboard/utils/projectCalculations";
import type { DailyStats } from "../types";

const formatUtcDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const utcDateDaysAgo = (daysAgo: number): string => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return formatUtcDate(date);
};

describe("projectCalculations.generateTrendData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the latest 7 calendar days in ascending order", () => {
    const result = generateTrendData(undefined);

    expect(result).toHaveLength(7);
    expect(result.map((item) => item.date)).toEqual([
      utcDateDaysAgo(6),
      utcDateDaysAgo(5),
      utcDateDaysAgo(4),
      utcDateDaysAgo(3),
      utcDateDaysAgo(2),
      utcDateDaysAgo(1),
      utcDateDaysAgo(0),
    ]);
    expect(result.every((item) => item.total_tokens === 0)).toBe(true);
  });

  it("fills missing days with zeros and ignores stats outside the 7-day window", () => {
    const input: DailyStats[] = [
      {
        date: utcDateDaysAgo(0),
        total_tokens: 100,
        input_tokens: 60,
        output_tokens: 40,
        message_count: 5,
        session_count: 1,
        active_hours: 2,
      },
      {
        date: utcDateDaysAgo(2),
        total_tokens: 200,
        input_tokens: 120,
        output_tokens: 80,
        message_count: 7,
        session_count: 2,
        active_hours: 3,
      },
      {
        date: utcDateDaysAgo(10),
        total_tokens: 999,
        input_tokens: 500,
        output_tokens: 499,
        message_count: 99,
        session_count: 9,
        active_hours: 9,
      },
    ];

    const result = generateTrendData(input);

    expect(result).toHaveLength(7);
    expect(result.find((d) => d.date === utcDateDaysAgo(0))?.total_tokens).toBe(100);
    expect(result.find((d) => d.date === utcDateDaysAgo(2))?.total_tokens).toBe(200);
    expect(result.find((d) => d.date === utcDateDaysAgo(1))?.total_tokens).toBe(0);
    expect(result.some((d) => d.date === utcDateDaysAgo(10))).toBe(false);
  });
});
