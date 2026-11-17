/**
 * Local-day interval adapter (ADR 0002 §2–3, plan §4.8).
 *
 * Expected edges were cross-checked independently with Python `zoneinfo`
 * (scratch/an0a/tz-crosscheck.txt in the AN0a PR).
 */

import { describe, expect, it } from "vitest";
import {
  containsHalfOpen,
  dayKeysBetween,
  localDayIntervals,
  localDayKeyOf,
  previousPeriod,
  resolveLocalWallTime,
  sameElapsedCutoff,
  shiftDayKey,
  splitIntervalAt,
  startOfLocalDay,
  truncateIntervals,
} from "./localDayIntervals";

const at = (iso: string) => Date.parse(iso);
const HOUR = 3_600_000;
const lengthHours = (i: { start_utc: number; end_utc: number }) => (i.end_utc - i.start_utc) / HOUR;

const oneDay = (key: string, tz: string) => {
  const [interval] = localDayIntervals({ from: key, to: key }, tz);
  if (!interval) throw new Error("no interval");
  return interval;
};

describe("midnight that is not on a UTC hour (R2)", () => {
  it("Asia/Kolkata splits 18:20Z and 18:40Z into different days", () => {
    const [d17, d18] = localDayIntervals({ from: "2026-10-17", to: "2026-10-18" }, "Asia/Kolkata");
    expect(d17).toEqual({
      key: "2026-10-17",
      start_utc: at("2026-10-16T18:30:00Z"),
      end_utc: at("2026-10-17T18:30:00Z"),
    });
    expect(containsHalfOpen(d17!, at("2026-10-17T18:20:00Z"))).toBe(true);
    expect(containsHalfOpen(d17!, at("2026-10-17T18:40:00Z"))).toBe(false);
    expect(containsHalfOpen(d18!, at("2026-10-17T18:40:00Z"))).toBe(true);
  });

  it("Asia/Kathmandu (+5:45) starts the day at 18:15Z", () => {
    const d17 = oneDay("2026-10-17", "Asia/Kathmandu");
    expect(d17.start_utc).toBe(at("2026-10-16T18:15:00Z"));
    expect(d17.end_utc).toBe(at("2026-10-17T18:15:00Z"));
    expect(containsHalfOpen(d17, at("2026-10-17T18:10:00Z"))).toBe(true);
    expect(containsHalfOpen(d17, at("2026-10-17T18:20:00Z"))).toBe(false);
  });

  it("Asia/Seoul 00:30 belongs to the new day", () => {
    const d18 = oneDay("2026-10-18", "Asia/Seoul");
    expect(d18.start_utc).toBe(at("2026-10-17T15:00:00Z"));
    expect(containsHalfOpen(d18, at("2026-10-17T15:30:00Z"))).toBe(true);
    expect(localDayKeyOf(at("2026-10-17T15:30:00Z"), "Asia/Seoul")).toBe("2026-10-18");
  });
});

describe("DST days", () => {
  it("America/New_York has a 23-hour and a 25-hour day", () => {
    const spring = oneDay("2026-03-08", "America/New_York");
    expect(spring.start_utc).toBe(at("2026-03-08T05:00:00Z"));
    expect(spring.end_utc).toBe(at("2026-03-09T04:00:00Z"));
    expect(lengthHours(spring)).toBe(23);
    const fall = oneDay("2026-11-01", "America/New_York");
    expect(fall.start_utc).toBe(at("2026-11-01T04:00:00Z"));
    expect(fall.end_utc).toBe(at("2026-11-02T05:00:00Z"));
    expect(lengthHours(fall)).toBe(25);
  });

  it("Australia/Lord_Howe shifts by 30 minutes: 23.5- and 24.5-hour days", () => {
    const spring = oneDay("2026-10-04", "Australia/Lord_Howe");
    expect(spring.start_utc).toBe(at("2026-10-03T13:30:00Z"));
    expect(spring.end_utc).toBe(at("2026-10-04T13:00:00Z"));
    expect(lengthHours(spring)).toBe(23.5);
    const fall = oneDay("2026-04-05", "Australia/Lord_Howe");
    expect(fall.start_utc).toBe(at("2026-04-04T13:00:00Z"));
    expect(fall.end_utc).toBe(at("2026-04-05T13:30:00Z"));
    expect(lengthHours(fall)).toBe(24.5);
  });

  it("America/Santiago midnight in a gap starts the day after the gap", () => {
    // 2026-09-06 00:00 does not exist (clocks jump to 01:00 -03).
    expect(startOfLocalDay("2026-09-06", "America/Santiago")).toBe(at("2026-09-06T04:00:00Z"));
    const [d5, d6] = localDayIntervals({ from: "2026-09-05", to: "2026-09-06" }, "America/Santiago");
    expect(lengthHours(d5!)).toBe(24);
    expect(lengthHours(d6!)).toBe(23);
  });
});

describe("Pacific/Apia skipped 2011-12-30", () => {
  const days = localDayIntervals({ from: "2011-12-29", to: "2011-12-31" }, "Pacific/Apia");

  it("the missing date is a zero-length interval at the jump", () => {
    const jump = at("2011-12-30T10:00:00Z");
    expect(days.map((d) => d.key)).toEqual(["2011-12-29", "2011-12-30", "2011-12-31"]);
    expect(days[0]).toMatchObject({ start_utc: at("2011-12-29T10:00:00Z"), end_utc: jump });
    expect(days[1]).toMatchObject({ start_utc: jump, end_utc: jump });
    expect(days[2]).toMatchObject({ start_utc: jump, end_utc: at("2011-12-31T10:00:00Z") });
  });

  it("no instant falls in the missing date", () => {
    const missing = days[1]!;
    expect(containsHalfOpen(missing, missing.start_utc)).toBe(false);
    expect(localDayKeyOf(missing.start_utc - 1, "Pacific/Apia")).toBe("2011-12-29");
    expect(localDayKeyOf(missing.start_utc, "Pacific/Apia")).toBe("2011-12-31");
  });
});

describe("wall-clock resolution: gap → after the gap, fold → earlier", () => {
  it("America/New_York", () => {
    expect(resolveLocalWallTime("2026-03-08", { hour: 2, minute: 30 }, "America/New_York")).toBe(
      at("2026-03-08T07:00:00Z"),
    );
    expect(resolveLocalWallTime("2026-11-01", { hour: 1, minute: 30 }, "America/New_York")).toBe(
      at("2026-11-01T05:30:00Z"),
    );
  });

  it("Australia/Lord_Howe (30-minute gap and fold)", () => {
    expect(resolveLocalWallTime("2026-10-04", { hour: 2, minute: 15 }, "Australia/Lord_Howe")).toBe(
      at("2026-10-03T15:30:00Z"),
    );
    expect(resolveLocalWallTime("2026-04-05", { hour: 1, minute: 45 }, "Australia/Lord_Howe")).toBe(
      at("2026-04-04T14:45:00Z"),
    );
  });

  it("Pacific/Apia: any time on the missing date resolves to the jump", () => {
    expect(resolveLocalWallTime("2011-12-30", { hour: 12, minute: 0 }, "Pacific/Apia")).toBe(
      at("2011-12-30T10:00:00Z"),
    );
  });

  it("an ordinary time keeps seconds and milliseconds", () => {
    expect(
      resolveLocalWallTime("2026-10-17", { hour: 23, minute: 59, second: 59, millisecond: 999 }, "Asia/Kolkata"),
    ).toBe(at("2026-10-17T18:29:59.999Z"));
  });
});

describe("same elapsed time and today in progress", () => {
  it("cuts the previous day at the same local wall time, resolving a gap", () => {
    // Now: Monday 2026-03-09 02:30 EDT; the day before has no 02:30.
    const now = at("2026-03-09T06:30:00Z");
    expect(sameElapsedCutoff("2026-03-08", now, "America/New_York")).toBe(at("2026-03-08T07:00:00Z"));
  });

  it("cuts the previous day at the earlier occurrence in a fold", () => {
    const now = at("2026-11-02T06:30:00Z"); // 2026-11-02 01:30 EST
    expect(sameElapsedCutoff("2026-11-01", now, "America/New_York")).toBe(at("2026-11-01T05:30:00Z"));
  });

  it("splitIntervalAt gives two touching intervals with distinct keys", () => {
    const day = oneDay("2026-10-17", "Asia/Kolkata");
    const cut = at("2026-10-17T06:00:00Z");
    const [head, tail] = splitIntervalAt(day, cut);
    expect(head).toEqual({ key: "2026-10-17@head", start_utc: day.start_utc, end_utc: cut });
    expect(tail).toEqual({ key: "2026-10-17@tail", start_utc: cut, end_utc: day.end_utc });
    expect(splitIntervalAt(day, day.end_utc + HOUR)[1].start_utc).toBe(day.end_utc);
  });

  it("truncateIntervals makes today [00:00, now) and later days empty", () => {
    const days = localDayIntervals({ from: "2026-10-17", to: "2026-10-19" }, "Asia/Seoul");
    const now = at("2026-10-18T03:00:00Z"); // 2026-10-18 12:00 KST
    const cut = truncateIntervals(days, now);
    expect(cut[0]).toEqual(days[0]);
    expect(cut[1]).toEqual({ ...days[1], end_utc: now });
    expect(cut[2]).toEqual({ ...days[2], end_utc: days[2]!.start_utc });
  });
});

describe("calendar helpers", () => {
  it("previous period is the same number of dates right before", () => {
    expect(previousPeriod({ from: "2026-10-12", to: "2026-10-18" })).toEqual({
      from: "2026-10-05",
      to: "2026-10-11",
    });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-01-29",
      to: "2026-02-28",
    });
  });

  it("dayKeysBetween is inclusive and crosses month and year ends", () => {
    expect(dayKeysBetween("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(shiftDayKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("rejects invalid keys, reversed ranges and unknown zones", () => {
    expect(() => dayKeysBetween("2026-02-30", "2026-03-01")).toThrow(RangeError);
    expect(() => dayKeysBetween("2026-10-18", "2026-10-17")).toThrow(RangeError);
    expect(() => localDayIntervals({ from: "2026-10-17", to: "2026-10-17" }, "Mars/Olympus")).toThrow(
      RangeError,
    );
  });

  it("refuses more intervals than the backend accepts", () => {
    expect(() => localDayIntervals({ from: "2023-01-01", to: "2026-12-31" }, "UTC")).toThrow(/at most/);
  });
});

describe("invariants over a whole year", () => {
  const zones: Array<[string, string, string]> = [
    ["Asia/Kolkata", "2026-01-01", "2026-12-31"],
    ["Asia/Kathmandu", "2026-01-01", "2026-12-31"],
    ["America/New_York", "2026-01-01", "2026-12-31"],
    ["Australia/Lord_Howe", "2026-01-01", "2026-12-31"],
    ["America/Santiago", "2026-01-01", "2026-12-31"],
    ["Asia/Seoul", "2026-01-01", "2026-12-31"],
    ["Pacific/Apia", "2011-06-01", "2012-05-31"],
  ];

  for (const [tz, from, to] of zones) {
    it(`${tz}: contiguous, ordered, each day maps back to its own date`, () => {
      const days = localDayIntervals({ from, to }, tz);
      days.forEach((day, i) => {
        if (i > 0) expect(day.start_utc).toBe(days[i - 1]!.end_utc);
        expect(day.end_utc).toBeGreaterThanOrEqual(day.start_utc);
        if (day.end_utc > day.start_utc) {
          expect(localDayKeyOf(day.start_utc, tz)).toBe(day.key);
          expect(localDayKeyOf(day.end_utc - 1, tz)).toBe(day.key);
          expect(localDayKeyOf(day.start_utc - 1, tz)).not.toBe(day.key);
        }
        expect([0, 23, 23.5, 24, 24.5, 25]).toContain(lengthHours(day));
      });
    });
  }
});
