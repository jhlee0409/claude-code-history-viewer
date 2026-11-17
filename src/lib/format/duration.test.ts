import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";
import { withOsLocale } from "@/test/osLocale";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatDuration", () => {
  it("shows the two largest units, narrow by default", () => {
    expect(formatDuration(3 * HOUR + 49 * MINUTE + 50 * SECOND, "en")).toBe("3h 49m");
    expect(formatDuration(13 * DAY + 16 * HOUR + 5 * MINUTE, "en")).toBe("13d 16h");
    expect(formatDuration(65 * SECOND, "en")).toBe("1m 5s");
    expect(formatDuration(2 * HOUR, "en")).toBe("2h");
    expect(formatDuration(12 * MINUTE, "en")).toBe("12m");
  });

  it("keeps one decimal under ten seconds and whole seconds under a minute", () => {
    expect(formatDuration(2_104, "en")).toBe("2.1s");
    expect(formatDuration(48_210, "en")).toBe("48s");
    expect(formatDuration(450, "en")).toBe("450ms");
    expect(formatDuration(0, "en")).toBe("0s");
  });

  it("can stop at minutes for session lengths", () => {
    expect(formatDuration(30 * SECOND, "en", { smallestUnit: "minute" })).toBe("<1m");
    expect(formatDuration(90 * SECOND, "en", { smallestUnit: "minute" })).toBe("1m");
    expect(formatDuration(0, "en", { smallestUnit: "minute" })).toBe("<1m");
  });

  it("has a long style", () => {
    expect(formatDuration(DAY + 2 * HOUR + 3 * MINUTE, "en", { style: "long" })).toBe("1 day, 2 hours");
    expect(formatDuration(1 * MINUTE, "en", { style: "long" })).toBe("1 minute");
    expect(formatDuration(20 * SECOND, "en", { style: "long", smallestUnit: "minute" })).toBe(
      "<1 minute",
    );
  });

  it.each([
    ["en", "3h 49m", "<1m", "2.1s"],
    ["ko", "3시간 49분", "<1분", "2.1초"],
    ["ja", "3h49m", "<1m", "2.1s"],
    ["zh-CN", "3小时49分钟", "<1分钟", "2.1秒"],
    ["zh-TW", "3 小時49 分鐘", "<1 分鐘", "2.1 秒"],
  ])("uses the app language's units (%s)", (lang, hm, lessThanMinute, seconds) => {
    expect(formatDuration(3 * HOUR + 49 * MINUTE, lang)).toBe(hm);
    expect(formatDuration(10 * SECOND, lang, { smallestUnit: "minute" })).toBe(lessThanMinute);
    expect(formatDuration(2_104, lang)).toBe(seconds);
  });

  it("shows a dash for negative or missing values", () => {
    expect(formatDuration(-5, "en")).toBe("—");
    expect(formatDuration(Number.NaN, "en")).toBe("—");
  });

  it("ignores the OS locale", () => {
    withOsLocale("ko-KR", () => {
      expect(formatDuration(3 * HOUR + 49 * MINUTE, "en")).toBe("3h 49m");
    });
  });
});
