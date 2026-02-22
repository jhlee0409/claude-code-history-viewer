import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTrendData } from "../components/AnalyticsDashboard/utils/projectCalculations";
import type { DailyStats } from "../types";

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const localDateDaysAgo = (daysAgo: number): string => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return formatLocalDate(date);
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
      localDateDaysAgo(6),
      localDateDaysAgo(5),
      localDateDaysAgo(4),
      localDateDaysAgo(3),
      localDateDaysAgo(2),
      localDateDaysAgo(1),
      localDateDaysAgo(0),
    ]);
    expect(result.every((item) => item.total_tokens === 0)).toBe(true);
  });

  it("fills missing days with zeros and ignores stats outside the 7-day window", () => {
    const input: DailyStats[] = [
      {
        date: localDateDaysAgo(0),
        total_tokens: 100,
        input_tokens: 60,
        output_tokens: 40,
        message_count: 5,
        session_count: 1,
        active_hours: 2,
      },
      {
        date: localDateDaysAgo(2),
        total_tokens: 200,
        input_tokens: 120,
        output_tokens: 80,
        message_count: 7,
        session_count: 2,
        active_hours: 3,
      },
      {
        date: localDateDaysAgo(10),
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
    expect(result.find((d) => d.date === localDateDaysAgo(0))?.total_tokens).toBe(100);
    expect(result.find((d) => d.date === localDateDaysAgo(2))?.total_tokens).toBe(200);
    expect(result.find((d) => d.date === localDateDaysAgo(1))?.total_tokens).toBe(0);
    expect(result.some((d) => d.date === localDateDaysAgo(10))).toBe(false);
  });
});

