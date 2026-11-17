import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateTrendData } from "../components/AnalyticsDashboard/utils/projectCalculations";
import { localDayKey, shiftDayKey } from "@/lib/format/localDay";
import type { DailyStats } from "../types";

// The trend window ends on the *local* date. Pin the zone so the test does
// not depend on the machine running it.
const TZ = "Asia/Seoul";

const localDateDaysAgo = (daysAgo: number): string =>
  shiftDayKey(localDayKey(Date.now(), TZ) as string, -daysAgo);

describe("projectCalculations.generateTrendData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-22T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the latest 7 calendar days in ascending order", () => {
    const result = generateTrendData(undefined, 7, TZ);

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

  it("ends the default window on the local date, not the UTC one", () => {
    // 2026-02-22T16:30Z is 01:30 on the 23rd in Seoul. The old UTC window
    // ended on the 22nd, so today's bar was missing until 09:00 KST.
    vi.setSystemTime(new Date("2026-02-22T16:30:00Z"));
    const result = generateTrendData(undefined, 7, TZ);
    expect(result.at(-1)?.date).toBe("2026-02-23");
    expect(result[0]?.date).toBe("2026-02-17");

    const newYork = generateTrendData(undefined, 7, "America/New_York");
    expect(newYork.at(-1)?.date).toBe("2026-02-22");
  });

  it("fills missing days with zeros and spans the actual data range", () => {
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

    const result = generateTrendData(input, 7, TZ);

    // When data spans 10 days ago to today, the range covers all 11 calendar days
    expect(result).toHaveLength(11);
    expect(result.find((d) => d.date === localDateDaysAgo(0))?.total_tokens).toBe(100);
    expect(result.find((d) => d.date === localDateDaysAgo(2))?.total_tokens).toBe(200);
    expect(result.find((d) => d.date === localDateDaysAgo(10))?.total_tokens).toBe(999);
    // Missing days within the range are filled with zeros
    expect(result.find((d) => d.date === localDateDaysAgo(1))?.total_tokens).toBe(0);
    expect(result.find((d) => d.date === localDateDaysAgo(5))?.total_tokens).toBe(0);
  });

  it("keeps backend date keys as calendar dates across a month end", () => {
    const row = (date: string): DailyStats => ({
      date,
      total_tokens: 1,
      input_tokens: 1,
      output_tokens: 0,
      message_count: 1,
      session_count: 1,
      active_hours: 1,
    });
    const result = generateTrendData([row("2026-02-27"), row("2026-03-02")], 7, "America/Los_Angeles");
    expect(result.map((d) => d.date)).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("throws a clear error for malformed backend dates", () => {
    const malformed: DailyStats[] = [
      {
        date: "bad-date",
        total_tokens: 100,
        input_tokens: 50,
        output_tokens: 50,
        message_count: 2,
        session_count: 1,
        active_hours: 1,
      },
    ];

    expect(() => generateTrendData(malformed)).toThrow(
      "Invalid daily_stats date: bad-date"
    );
  });
});
