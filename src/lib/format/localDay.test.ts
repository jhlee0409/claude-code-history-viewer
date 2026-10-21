import { describe, expect, it } from "vitest";
import {
  dayKeysBetween,
  localDayIntervals,
  localDayKey,
  previousPeriod,
  shiftDayKey,
  startOfLocalDay,
  systemTimeZone,
} from "./localDay";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("localDayKey", () => {
  it("splits fractional-offset zones at local midnight (Kolkata, Kathmandu)", () => {
    // UTC-hour buckets cannot split these: both instants are in the 18:00Z hour.
    expect(localDayKey(Date.parse("2026-10-17T18:20:00Z"), "Asia/Kolkata")).toBe("2026-10-17");
    expect(localDayKey(Date.parse("2026-10-17T18:40:00Z"), "Asia/Kolkata")).toBe("2026-10-18");
    expect(localDayKey(Date.parse("2026-10-17T18:10:00Z"), "Asia/Kathmandu")).toBe("2026-10-17");
    expect(localDayKey(Date.parse("2026-10-17T18:20:00Z"), "Asia/Kathmandu")).toBe("2026-10-18");
  });

  it("puts 00:30 in Seoul on the Seoul date, not the UTC one", () => {
    const at = Date.parse("2026-06-20T15:30:00Z"); // 2026-06-21 00:30 KST
    expect(localDayKey(at, "Asia/Seoul")).toBe("2026-06-21");
    expect(new Date(at).toISOString().slice(0, 10)).toBe("2026-06-20");
  });

  it("accepts ISO strings and defaults to the system zone", () => {
    expect(localDayKey("2026-06-20T15:30:00Z", "Asia/Seoul")).toBe("2026-06-21");
    expect(typeof systemTimeZone()).toBe("string");
    expect(localDayKey("2026-06-20T12:00:00Z")).toBe(
      localDayKey("2026-06-20T12:00:00Z", systemTimeZone()),
    );
  });

  it("returns null for an unreadable timestamp", () => {
    expect(localDayKey("nope", "UTC")).toBeNull();
  });
});

describe("day key arithmetic", () => {
  it("shifts and enumerates calendar dates", () => {
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDayKey("2024-02-28", 1)).toBe("2024-02-29");
    expect(dayKeysBetween("2026-06-29", "2026-07-02")).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
    ]);
    expect(() => dayKeysBetween("2026-07-02", "2026-07-01")).toThrow(RangeError);
    expect(() => shiftDayKey("2026-02-30", 1)).toThrow(RangeError);
  });

  it("takes the previous period by calendar days", () => {
    expect(previousPeriod({ from: "2026-10-11", to: "2026-10-17" })).toEqual({
      from: "2026-10-04",
      to: "2026-10-10",
    });
  });
});

describe("localDayIntervals — [start, end) per local date", () => {
  it("covers a 24h day in Seoul", () => {
    const [day] = localDayIntervals({ from: "2026-06-21", to: "2026-06-21" }, "Asia/Seoul");
    expect(day).toEqual({
      key: "2026-06-21",
      start_utc: Date.parse("2026-06-20T15:00:00Z"),
      end_utc: Date.parse("2026-06-21T15:00:00Z"),
    });
  });

  it("is contiguous and half-open", () => {
    const days = localDayIntervals({ from: "2026-10-16", to: "2026-10-19" }, "Asia/Kolkata");
    expect(days.map((d) => d.key)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
    for (let i = 1; i < days.length; i++) {
      expect(days[i]!.start_utc).toBe(days[i - 1]!.end_utc);
    }
    expect(iso(days[1]!.start_utc)).toBe("2026-10-16T18:30:00.000Z");
  });

  it("has a 23-hour and a 25-hour day across New York DST", () => {
    const [spring] = localDayIntervals({ from: "2026-03-08", to: "2026-03-08" }, "America/New_York");
    const [fall] = localDayIntervals({ from: "2026-11-01", to: "2026-11-01" }, "America/New_York");
    expect(spring!.end_utc - spring!.start_utc).toBe(23 * HOUR);
    expect(fall!.end_utc - fall!.start_utc).toBe(25 * HOUR);
    expect(iso(spring!.start_utc)).toBe("2026-03-08T05:00:00.000Z");
  });

  it("handles Lord Howe's 30-minute DST shift", () => {
    // DST ends 2026-04-05 02:00 → 01:30; starts 2026-10-04 02:00 → 02:30.
    const [end] = localDayIntervals({ from: "2026-04-05", to: "2026-04-05" }, "Australia/Lord_Howe");
    const [start] = localDayIntervals({ from: "2026-10-04", to: "2026-10-04" }, "Australia/Lord_Howe");
    expect(end!.end_utc - end!.start_utc).toBe(24.5 * HOUR);
    expect(start!.end_utc - start!.start_utc).toBe(23.5 * HOUR);
  });

  it("gives a date that never happened (Apia 2011-12-30) a zero-length interval", () => {
    const days = localDayIntervals({ from: "2011-12-29", to: "2011-12-31" }, "Pacific/Apia");
    const missing = days.find((d) => d.key === "2011-12-30")!;
    expect(missing.end_utc - missing.start_utc).toBe(0);
    expect(days[0]!.end_utc).toBe(missing.start_utc);
    expect(missing.end_utc).toBe(days[2]!.start_utc);
  });

  it("agrees with localDayKey at every edge", () => {
    const zones = [
      "Asia/Seoul",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "America/New_York",
      "Australia/Lord_Howe",
      "Pacific/Apia",
      "UTC",
    ];
    for (const zone of zones) {
      for (const day of localDayIntervals({ from: "2026-03-01", to: "2026-11-30" }, zone)) {
        if (day.end_utc === day.start_utc) continue;
        expect(localDayKey(day.start_utc, zone)).toBe(day.key);
        expect(localDayKey(day.end_utc - 1, zone)).toBe(day.key);
        expect(localDayKey(day.end_utc, zone)).not.toBe(day.key);
      }
    }
  });

  it("starts a day at local midnight", () => {
    expect(iso(startOfLocalDay("2026-10-18", "Asia/Kathmandu"))).toBe("2026-10-17T18:15:00.000Z");
  });

  it("rejects an unknown zone", () => {
    expect(() => localDayIntervals({ from: "2026-01-01", to: "2026-01-01" }, "Mars/Olympus")).toThrow(
      RangeError,
    );
  });
});
