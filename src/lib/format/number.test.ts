import { describe, expect, it } from "vitest";
import {
  COMPACT_FROM,
  changePercent,
  formatBytes,
  formatChange,
  formatCost,
  formatCount,
  formatNumber,
  formatPercent,
  formatTokens,
} from "./number";
import { localeFor } from "./locale";
import { withOsLocale } from "@/test/osLocale";

const LANGUAGES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;
/** U+2060 WORD JOINER: invisible, no width, no line break on either side. */
const WJ = "\u2060";

describe("formatNumber / formatTokens", () => {
  it("groups below 10K and compacts from 10K up", () => {
    expect(COMPACT_FROM).toBe(10_000);
    expect(formatTokens(0, "en")).toBe("0");
    expect(formatTokens(999, "en")).toBe("999");
    expect(formatTokens(1_434, "en")).toBe("1,434");
    expect(formatTokens(9_999, "en")).toBe("9,999");
    expect(formatTokens(10_000, "en")).toBe("10K");
    expect(formatTokens(12_345, "en")).toBe("12.3K");
    expect(formatTokens(123_456, "en")).toBe("123K");
    expect(formatTokens(1_234_567, "en")).toBe("1.2M");
    expect(formatTokens(51_400_000, "en")).toBe("51.4M");
  });

  it.each([
    ["en", "59.4M", "51.4M", "1.2M", "9,999"],
    ["ko", `5940${WJ}만`, `5140${WJ}만`, `123${WJ}만`, "9,999"],
    ["ja", `5940${WJ}万`, `5140${WJ}万`, `123${WJ}万`, "9,999"],
    ["zh-CN", `5940${WJ}万`, `5140${WJ}万`, `123${WJ}万`, "9,999"],
    ["zh-TW", `5940${WJ}萬`, `5140${WJ}萬`, `123${WJ}萬`, "9,999"],
  ])("uses the app language's compact units (%s)", (lang, a, b, c, small) => {
    expect(formatTokens(59_427_870, lang)).toBe(a);
    expect(formatTokens(51_400_000, lang)).toBe(b);
    expect(formatTokens(1_234_567, lang)).toBe(c);
    expect(formatTokens(9_999, lang)).toBe(small);
  });

  it("formats the audit's mixed pair the same way on one screen", () => {
    // Global stats showed provider totals grouped ('59,427,870') beside
    // model totals compact ('51.4M'). Both are token totals → one style.
    const provider = formatTokens(59_427_870, "en");
    const model = formatTokens(51_400_000, "en");
    expect([provider, model]).toEqual(["59.4M", "51.4M"]);
    expect(provider).not.toMatch(/,/);
  });

  it("keeps counts grouped at any size", () => {
    expect(formatCount(1_369, "en")).toBe("1,369");
    expect(formatCount(59_427_870, "en")).toBe("59,427,870");
    expect(formatNumber(59_427_870, "en", { style: "grouped" })).toBe("59,427,870");
    expect(formatNumber(1_500, "en", { style: "compact" })).toBe("1.5K");
  });

  it("shows a dash for values that are not numbers", () => {
    expect(formatTokens(Number.NaN, "en")).toBe("—");
    expect(formatCount(Number.POSITIVE_INFINITY, "en")).toBe("—");
  });

  it("handles negative values symmetrically", () => {
    expect(formatTokens(-12_345, "en")).toBe("-12.3K");
    expect(formatCount(-1_234, "en")).toBe("-1,234");
  });
});

describe("compact numbers are one unbreakable run (F3b review 6)", () => {
  // CJK magnitude suffixes are ideographs or Hangul syllables, and Unicode
  // line breaking (UAX #14) allows a break between a digit and those: at
  // 390 px the overview footer wrapped `1120万` as `1120` / `万`. A word
  // joiner between numeral and suffix (and inside a two-character suffix)
  // removes that break opportunity wherever the text is rendered.
  it.each([
    ["ko", 11_200_000, `1120${WJ}만`],
    ["ko", 120_000_000, `1.2${WJ}억`],
    ["ko", 1.2e12, `1.2${WJ}조`],
    ["ja", 11_200_000, `1120${WJ}万`],
    ["ja", 120_000_000, `1.2${WJ}億`],
    ["ja", 1.2e12, `1.2${WJ}兆`],
    ["zh-CN", 11_200_000, `1120${WJ}万`],
    ["zh-CN", 120_000_000, `1.2${WJ}亿`],
    ["zh-CN", 1.2e12, `1.2${WJ}万${WJ}亿`],
    ["zh-TW", 11_200_000, `1120${WJ}萬`],
    ["zh-TW", 120_000_000, `1.2${WJ}億`],
    ["zh-TW", 1.2e12, `1.2${WJ}兆`],
  ])("%s %d: numeral and suffix joined by U+2060", (lang, value, expected) => {
    expect(formatTokens(value, lang)).toBe(expected);
  });

  it("joins a Korean thousand (천) and a negative amount the same way", () => {
    expect(formatNumber(1_500, "ko", { style: "compact" })).toBe(`1.5${WJ}천`);
    expect(formatTokens(-11_200_000, "ko")).toBe(`-1120${WJ}만`);
  });

  it("adds nothing to Latin suffixes: a digit and a letter never break", () => {
    for (const value of [12_345, 11_200_000, 120_000_000, 1.2e12, -12_345]) {
      expect(formatTokens(value, "en")).not.toContain(WJ);
    }
    expect(formatTokens(11_200_000, "en")).toBe("11.2M");
    expect(formatTokens(1.2e12, "en")).toBe("1.2T");
  });

  it.each(LANGUAGES)("%s: the joiner is the only change, and never at either end", (lang) => {
    const intl = new Intl.NumberFormat(localeFor(lang), {
      notation: "compact",
      maximumFractionDigits: 1,
      maximumSignificantDigits: 3,
      roundingPriority: "lessPrecision",
    } as Intl.NumberFormatOptions);
    for (const value of [10_000, 12_345, 455_000, 11_200_000, 59_427_870, 120_000_000, 1.2e12, -11_200_000]) {
      const text = formatTokens(value, lang);
      expect(text.split(WJ).join(""), text).toBe(intl.format(value));
      // A joiner at an end would also glue the number to the space beside it.
      expect(text.startsWith(WJ) || text.endsWith(WJ), text).toBe(false);
    }
  });

  it("leaves grouped values alone", () => {
    for (const lang of LANGUAGES) expect(formatTokens(9_999, lang)).toBe("9,999");
    expect(formatCount(59_427_870, "ko")).toBe("59,427,870");
  });
});

describe("formatCost", () => {
  it("always shows two decimals with a dollar sign", () => {
    expect(formatCost(34.1, "en")).toBe("$34.10");
    expect(formatCost(6.857, "en")).toBe("$6.86");
    expect(formatCost(0.49, "en")).toBe("$0.49");
    expect(formatCost(1234.5, "en")).toBe("$1,234.50");
    expect(formatCost(0, "en")).toBe("$0.00");
  });

  it("says '<$0.01' for every positive cost under a cent, on both sides of half a cent", () => {
    expect(formatCost(0.0000001, "en")).toBe("<$0.01");
    expect(formatCost(0.004, "en")).toBe("<$0.01");
    expect(formatCost(0.0049, "en")).toBe("<$0.01");
    expect(formatCost(0.005, "en")).toBe("<$0.01");
    expect(formatCost(0.006, "en")).toBe("<$0.01");
    expect(formatCost(0.00999, "en")).toBe("<$0.01");
    // One cent and above keeps the normal two decimals.
    expect(formatCost(0.01, "en")).toBe("$0.01");
    expect(formatCost(0.0101, "en")).toBe("$0.01");
  });

  it.each(LANGUAGES)("uses a plain $ (not US$) in %s", (lang) => {
    expect(formatCost(1234.5, lang)).toBe("$1,234.50");
    expect(formatCost(0.006, lang)).toBe("<$0.01");
    expect(formatCost(0.01, lang)).toBe("$0.01");
  });
});

describe("formatPercent", () => {
  it("rounds to whole percents", () => {
    expect(formatPercent(0.453, "en")).toBe("45%");
    expect(formatPercent(0.4549, "en")).toBe("45%");
    expect(formatPercent(1, "en")).toBe("100%");
    expect(formatPercent(0, "en")).toBe("0%");
  });

  it("never rounds a non-zero share to 0% or a partial share to 100%", () => {
    expect(formatPercent(0.001, "en")).toBe("<1%");
    expect(formatPercent(0.998, "en")).toBe(">99%");
  });

  it("sends 99.5% and above to '>99%' — a partial share is never 100%", () => {
    expect(formatPercent(0.9949, "en")).toBe("99%");
    expect(formatPercent(0.995, "en")).toBe(">99%");
    expect(formatPercent(0.9951, "en")).toBe(">99%");
    expect(formatPercent(0.9999, "en")).toBe(">99%");
    expect(formatPercent(1, "en")).toBe("100%");
  });

  it("rounds exactly half a percent up to a real 1%", () => {
    expect(formatPercent(0.005, "en")).toBe("1%");
    expect(formatPercent(0.0049, "en")).toBe("<1%");
  });

  it.each(LANGUAGES)("formats in %s", (lang) => {
    expect(formatPercent(0.453, lang)).toBe("45%");
    expect(formatPercent(0.995, lang)).toBe(">99%");
  });
});

describe("formatChange", () => {
  it("reports direction and size without judging it", () => {
    expect(formatChange(100, 125, "en")).toEqual({ direction: "up", text: "+25%" });
    expect(formatChange(100, 80, "en")).toEqual({ direction: "down", text: "-20%" });
    expect(formatChange(100, 100, "en")).toEqual({ direction: "flat", text: "0%" });
  });

  it("has no percentage when there is nothing to compare against", () => {
    expect(formatChange(0, 10, "en")).toEqual({ direction: "new", text: "" });
    expect(formatChange(0, 0, "en")).toEqual({ direction: "flat", text: "0%" });
  });
});

describe("changePercent", () => {
  it("is the whole-percent change formatChange shows, as a number (trend chips compare it)", () => {
    expect(changePercent(100, 125)).toBe(25);
    expect(changePercent(100, 80)).toBe(-20);
    expect(changePercent(30, 200)).toBe(567);
    expect(changePercent(-100, -50)).toBe(50); // against |previous|, like formatChange
    expect(formatChange(30, 200, "en").text).toBe(`+${changePercent(30, 200)}%`);
  });

  it("never returns -0", () => {
    expect(changePercent(300, 299)).toBe(0);
    expect(Object.is(changePercent(300, 299), -0)).toBe(false);
  });
});

describe("formatBytes", () => {
  it("keeps the existing binary steps with one decimal", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(0.5, "en")).toBe("0 B");
    expect(formatBytes(512, "en")).toBe("512.0 B");
    expect(formatBytes(1024, "en")).toBe("1.0 KB");
    expect(formatBytes(-1024, "en")).toBe("-1.0 KB");
    expect(formatBytes(1536 * 1024, "en")).toBe("1.5 MB");
    expect(formatBytes(Number.NaN, "en")).toBe("0 B");
    expect(formatBytes(1024 ** 6, "en")).toMatch(/ TB$/);
  });
});

describe("app language, not the OS locale", () => {
  it("ignores an OS locale that differs from the app language", () => {
    withOsLocale("ko-KR", () => {
      // Control: the stub really changes the OS default.
      expect((59_427_870).toLocaleString(undefined, { notation: "compact" })).toMatch(/만/);
      expect(formatTokens(59_427_870, "en")).toBe("59.4M");
      expect(formatCost(1234.5, "en")).toBe("$1,234.50");
      expect(formatPercent(0.453, "en")).toBe("45%");
    });
    withOsLocale("de-DE", () => {
      expect(formatCount(1_369, "en")).toBe("1,369");
      expect(formatCount(1_369, "ko")).toBe("1,369");
    });
  });
});
