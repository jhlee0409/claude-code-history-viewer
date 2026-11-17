import { describe, expect, it } from "vitest";
import "@/i18n";
import {
  formatDate,
  formatDateDivider,
  formatDateTime,
  formatDateTimeFull,
  formatDayKey,
  formatMonth,
  formatRelative,
  formatTime,
  isSameLocalDay,
} from "./date";
import { withOsLocale } from "@/test/osLocale";

const TZ = "Asia/Seoul";
// 2026-06-30 06:44:30 in Seoul.
const AT = "2026-06-29T21:44:30Z";
const NOW = Date.parse("2026-07-02T03:00:00Z");

// Korean's AM marker is CLDR data that changed: "오전" up to CLDR 47, "AM"
// from CLDR 48 (ICU 78, Node 20.20+). Take it from the running ICU; the rest
// of every Korean string below (order, spacing, date, no seconds) is fixed.
const KO_AM =
  new Intl.DateTimeFormat("ko", { hour: "numeric", timeZone: "UTC" })
    .formatToParts(Date.UTC(2026, 0, 1, 6))
    .find((part) => part.type === "dayPeriod")?.value ?? "";

it("Korean AM marker is one of the known CLDR forms", () => {
  expect(["오전", "AM"]).toContain(KO_AM);
});

describe("formatTime / formatDateTime — two styles, no seconds", () => {
  it.each([
    ["en", "6:44 AM", "Jun 30, 6:44 AM"],
    ["ko", `${KO_AM} 6:44`, `6월 30일 ${KO_AM} 6:44`],
    ["ja", "6:44", "6月30日 6:44"],
    ["zh-CN", "6:44", "6月30日 6:44"],
    ["zh-TW", "上午6:44", "6月30日 上午6:44"],
  ])("%s", (lang, time, dateTime) => {
    expect(formatTime(AT, lang, { timeZone: TZ })).toBe(time);
    expect(formatDateTime(AT, lang, { timeZone: TZ, now: NOW })).toBe(dateTime);
  });

  it("adds the year when it is not the current one", () => {
    expect(formatDateTime(AT, "en", { timeZone: TZ, now: Date.parse("2027-01-05T00:00:00Z") })).toBe(
      "Jun 30, 2026, 6:44 AM",
    );
  });

  it("keeps seconds for the full form (tooltips)", () => {
    expect(formatDateTimeFull(AT, "en", { timeZone: TZ })).toBe("June 30, 2026 at 6:44:30 AM");
    expect(formatDateTimeFull(AT, "ko", { timeZone: TZ })).toBe(`2026년 6월 30일 ${KO_AM} 6:44:30`);
  });

  it("accepts epoch milliseconds and Date objects", () => {
    expect(formatTime(Date.parse(AT), "en", { timeZone: TZ })).toBe("6:44 AM");
    expect(formatTime(new Date(AT), "en", { timeZone: TZ })).toBe("6:44 AM");
  });

  it("returns the original text for an unreadable timestamp", () => {
    expect(formatTime("not a date", "en")).toBe("not a date");
    expect(formatDateTime("", "en")).toBe("");
  });
});

describe("formatDate", () => {
  it.each([
    ["en", "Jun 30", "Jun 30, 2026", "June 30, 2026", "Tuesday, June 30, 2026"],
    ["ko", "6월 30일", "2026년 6월 30일", "2026년 6월 30일", "2026년 6월 30일 화요일"],
    ["ja", "6月30日", "2026年6月30日", "2026年6月30日", "2026年6月30日火曜日"],
    ["zh-CN", "6月30日", "2026年6月30日", "2026年6月30日", "2026年6月30日星期二"],
    ["zh-TW", "6月30日", "2026年6月30日", "2026年6月30日", "2026年6月30日 星期二"],
  ])("%s", (lang, short, medium, long, weekday) => {
    // CLDR spacing differs between ICU versions (zh-TW weekday gained/lost a
    // space between Node 20 and 22); compare the words, not the gaps.
    const words = (s: string) => s.replace(/[\s\u00a0\u202f]/g, "");
    expect(words(formatDate(AT, lang, { style: "short", timeZone: TZ }))).toBe(words(short));
    expect(words(formatDate(AT, lang, { style: "medium", timeZone: TZ }))).toBe(words(medium));
    expect(words(formatDate(AT, lang, { style: "long", timeZone: TZ }))).toBe(words(long));
    expect(words(formatDate(AT, lang, { style: "weekday", timeZone: TZ }))).toBe(words(weekday));
  });

  it("formats a calendar day key without shifting it through a time zone", () => {
    // `new Date("2026-06-20")` is UTC midnight — in New York that is the 19th.
    expect(formatDayKey("2026-06-20", "en", { style: "short" })).toBe("Jun 20");
    expect(formatDayKey("2026-06-20", "en", { style: "day" })).toBe("20");
    expect(formatDayKey("2026-06-20", "ko", { style: "short" })).toBe("6월 20일");
  });

  it("formats a month", () => {
    expect(formatMonth("2026-06", "en")).toBe("Jun 2026");
    expect(formatMonth("2026-06", "ko")).toBe("2026년 6월");
    expect(formatMonth("2026-06", "ja")).toBe("2026年6月");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-06-30T12:00:00Z");
  it("uses the app language's relative words for the last week", () => {
    expect(formatRelative("2026-06-30T11:59:40Z", "en", { now })).toBe("just now");
    expect(formatRelative("2026-06-30T11:55:00Z", "en", { now })).toBe("5 minutes ago");
    expect(formatRelative("2026-06-30T09:00:00Z", "ko", { now })).toBe("3시간 전");
    expect(formatRelative("2026-06-28T12:00:00Z", "en", { now })).toBe("2 days ago");
  });

  it("falls back to a short date after a week", () => {
    expect(formatRelative("2026-06-01T12:00:00Z", "en", { now, timeZone: TZ })).toBe("Jun 1");
    expect(formatRelative("2026-06-01T12:00:00Z", "ko", { now, timeZone: TZ })).toBe("6월 1일");
  });

  it("returns the original text for an unreadable timestamp", () => {
    expect(formatRelative("garbage", "en", { now })).toBe("garbage");
  });
});

describe("formatDateDivider", () => {
  const now = Date.parse("2026-06-30T03:00:00Z"); // 12:00 in Seoul
  it("says today / yesterday by the local calendar day", () => {
    // 2026-06-29T16:00Z is 01:00 on the 30th in Seoul (still the 29th in UTC).
    expect(formatDateDivider("2026-06-29T16:00:00Z", "en", { now, timeZone: TZ })).toBe("Today");
    expect(formatDateDivider("2026-06-29T14:00:00Z", "en", { now, timeZone: TZ })).toBe("Yesterday");
    expect(formatDateDivider("2026-06-29T14:00:00Z", "ko", { now, timeZone: TZ })).toBe("어제");
  });

  it("uses a full weekday date otherwise", () => {
    expect(formatDateDivider("2026-06-26T03:00:00Z", "en", { now, timeZone: TZ })).toBe(
      "Friday, June 26, 2026",
    );
  });
});

describe("isSameLocalDay", () => {
  it("compares local calendar days", () => {
    expect(isSameLocalDay("2026-06-29T15:30:00Z", "2026-06-29T14:30:00Z", TZ)).toBe(false);
    expect(isSameLocalDay("2026-06-29T15:30:00Z", "2026-06-30T14:30:00Z", TZ)).toBe(true);
  });
});

describe("app language en + OS ko → no Korean dates", () => {
  it("never falls back to the OS locale", () => {
    withOsLocale("ko-KR", () => {
      // Control: unlocalized calls really print Korean under the stub (Hangul
      // in a date in every CLDR version; Korean order for a time).
      expect(new Date(AT).toLocaleDateString(undefined, { timeZone: TZ, month: "long" })).toBe("6월");
      expect(new Date(AT).toLocaleTimeString(undefined, { timeZone: TZ })).toBe(`${KO_AM} 6:44:30`);

      const outputs = [
        formatTime(AT, "en", { timeZone: TZ }),
        formatDateTime(AT, "en", { timeZone: TZ, now: NOW }),
        formatDateTimeFull(AT, "en", { timeZone: TZ }),
        formatDate(AT, "en", { style: "weekday", timeZone: TZ }),
        formatDayKey("2026-06-20", "en", { style: "short" }),
        formatMonth("2026-06", "en"),
        formatRelative("2026-06-01T12:00:00Z", "en", { now: NOW, timeZone: TZ }),
        formatDateDivider("2026-06-26T03:00:00Z", "en", { now: NOW, timeZone: TZ }),
      ];
      for (const text of outputs) {
        expect(text).not.toMatch(/[\uac00-\ud7af]/);
      }
      expect(outputs[0]).toBe("6:44 AM");
    });
  });
});
