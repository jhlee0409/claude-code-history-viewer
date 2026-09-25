import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLEANUP_PERIOD_DAYS,
  isValidCleanupPeriod,
  parseCleanupPeriodInput,
} from "./cleanupPeriod";

// Claude Code's `cleanupPeriodDays`: a whole number of days, minimum 1, no
// upper limit — its docs recommend a large value such as 3650 for long
// retention, and `0` fails its validation (#587).
describe("cleanupPeriodDays bounds", () => {
  it("defaults to Claude Code's 30 days", () => {
    expect(DEFAULT_CLEANUP_PERIOD_DAYS).toBe(30);
  });

  it("accepts long retention beyond a year", () => {
    expect(isValidCleanupPeriod(365)).toBe(true);
    expect(isValidCleanupPeriod(366)).toBe(true);
    expect(isValidCleanupPeriod(3650)).toBe(true);
  });

  it("rejects 0, negatives, fractions and non-numbers", () => {
    for (const value of [0, -1, 1.5, Number.NaN, "30", null, undefined]) {
      expect(isValidCleanupPeriod(value)).toBe(false);
    }
    expect(isValidCleanupPeriod(1)).toBe(true);
  });

  it("parses typed input only when it is a valid period", () => {
    expect(parseCleanupPeriodInput("3650")).toBe(3650);
    expect(parseCleanupPeriodInput(" 45 ")).toBe(45);
    for (const raw of ["0", "", "-3", "1.5", "1e3", "abc"]) {
      expect(parseCleanupPeriodInput(raw)).toBeUndefined();
    }
  });
});
