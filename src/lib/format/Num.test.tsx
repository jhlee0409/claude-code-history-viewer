import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Num } from "./Num";
import { hasCjkWord, numberRuns } from "./numberRuns";
import { formatterFor } from "./useFormat";

/**
 * Num renders a formatter result so that WebKit's Korean keep-all cannot
 * break inside its numbers. The real-WebKit side (every number on the board,
 * the archive, the transcript and the token KPIs stays on one line at 390 px /
 * 125 % and 130 %) is scripts/ui-capture/test/cjk.numericAtomic.test.mjs; the
 * guard that every formatter result goes through Num is num.invariant.test.ts.
 */

const WJ = "\u2060";

/** Each child node of the rendered <Num>: text, or a `[data-num]` span with its text. */
const shape = (text: string) => {
  const { container } = render(<p>{<Num>{text}</Num>}</p>);
  const p = container.querySelector("p")!;
  expect(p.textContent).toBe(text);
  const root = p.firstElementChild as HTMLElement;
  return {
    root: root.hasAttribute("data-num") ? "data-num" : root.hasAttribute("data-num-text") ? "data-num-text" : root.tagName,
    children: [...root.childNodes].map((n) =>
      n.nodeType === Node.TEXT_NODE ? n.nodeValue : `[${(n as HTMLElement).hasAttribute("data-num") ? "num" : "?"}]${n.textContent}`,
    ),
  };
};

describe("<Num>", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "7,803",
    `1.8${WJ}만`,
    `5940${WJ}만`,
    `1.2${WJ}万${WJ}亿`,
    "$270.29",
    "<$0.01",
    "-$3.00",
    ">99%",
    "+25%",
    "1.4 MB",
    "1:26 PM",
    "3h 49m",
    "6. 19.",
    "—",
  ])("renders %j, which has no CJK word, as one [data-num] span", (text) => {
    expect(shape(text)).toEqual({ root: "data-num", children: [text] });
  });

  it.each([
    ["오후 1:26", ["오후 ", "[num]1:26"]],
    ["2026년 6월 19일 오후 1:26:25", ["2026년 6월 19일 오후 ", "[num]1:26:25"]],
    ["2.1초", ["[num]2.1", "초"]],
    ["3시간 49분", ["3시간 49분"]],
    ["下午1:26", ["下午", "[num]1:26"]],
    ["6月19日 13:26", ["6月19日 ", "[num]13:26"]],
    ["총 세션: 1,234", ["총 세션: ", "[num]1,234"]],
    ["총 −1,200개", ["총 ", "[num]−1,200", "개"]],
    ["계산 중", ["계산 중"]],
  ])("keeps the words of %j as text and puts each punctuated number in its own [data-num]", (text, children) => {
    expect(shape(text)).toEqual({ root: "data-num-text", children });
  });

  it("renders nothing for an empty value, as React renders null, false and \"\"", () => {
    for (const value of [null, undefined, false, ""] as const) {
      const { container } = render(<p><Num>{value}</Num></p>);
      expect(container.querySelector("p")!.childNodes).toHaveLength(0);
    }
  });

  it("is inline and unstyled: no class, no style, the same text (and no key warning)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<p><Num>{"2026년 6월 19일 오후 1:26:25"}</Num></p>);
    for (const el of container.querySelectorAll("p *")) {
      expect(el.tagName).toBe("SPAN");
      expect(el.getAttribute("class")).toBeNull();
      expect(el.getAttribute("style")).toBeNull();
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("holds every formatter's output in every app language without changing its text", () => {
    const ts = "2026-06-19T04:26:25Z";
    for (const language of ["en", "ko", "ja", "zh-CN", "zh-TW"]) {
      const f = formatterFor(language);
      const outputs = [
        f.number(17_600), f.tokens(52_700_000_000), f.tokens(1.2e12), f.count(-1200), f.cost(270.29), f.cost(0.004),
        f.percent(0.453), f.percent(0.999), f.change(100, 125).text, f.bytes(1.4 * 1024 * 1024), f.duration(2100),
        f.duration(13_000_000), f.minutes(0.5), f.time(ts, { timeZone: "UTC" }), f.dateTime(ts, { timeZone: "UTC" }),
        f.dateTimeFull(ts, { timeZone: "UTC" }), f.date(ts, "numeric", { timeZone: "UTC" }), f.dayKey("2026-06-19"),
        f.month("2026-06"), f.decimal(1, 1),
      ];
      for (const text of outputs) {
        const { container, unmount } = render(<p><Num>{text}</Num></p>);
        expect(container.textContent, `${language} ${text}`).toBe(text);
        // Every number with an inner separator sits in a [data-num] of its own (or the whole is one).
        const nums = [...container.querySelectorAll("[data-num]")].map((n) => n.textContent ?? "");
        for (const [number] of text.matchAll(/\d+(?:[.,:/]\d+)+/g)) {
          expect(nums.some((n) => n.includes(number)), `${language} ${JSON.stringify(text)}: ${number}`).toBe(true);
        }
        unmount();
      }
    }
  });
});

describe("numberRuns", () => {
  it.each([
    ["2026년 6월 19일 오후 01:26:25", ["2026년 6월 19일 오후 ", "01:26:25"]],
    ["오전 7:05", ["오전 ", "7:05"]],
    ["총 1,234,567개", ["총 ", "1,234,567", "개"]],
    ["입력: 17.6K", ["입력: ", "17.6K"]],
    ["12.5% 증가", ["12.5%", " 증가"]],
    ["−1,200 → +3,400", ["−1,200", " → ", "+3,400"]],
    ["~$1.20 / <$0.01", ["~$1.20", " / ", "<$0.01"]],
    [`1.8${WJ}만 토큰`, [`1.8${WJ}만`, " 토큰"]],
    ["2026/06/19", ["2026/06/19"]],
  ])("cuts %j at its punctuated numbers", (text, parts) => {
    const runs = numberRuns(text);
    expect(runs.map((r) => r.text)).toEqual(parts);
    expect(runs.map((r) => r.text).join("")).toBe(text);
    for (const run of runs) expect(run.num, run.text).toBe(/\d[.,:/]\d/.test(run.text));
  });

  it.each(["2026년 6월 19일", "메시지 12개", "PR 42 --strict", "1.", "a.b"])("leaves %j, without a punctuated number, whole", (text) => {
    expect(numberRuns(text)).toEqual([{ text, num: false }]);
  });

  it("an empty text has no runs", () => {
    expect(numberRuns("")).toEqual([]);
  });
});

describe("hasCjkWord", () => {
  it("a compact number's joined CJK suffix is part of the number, other CJK is a word", () => {
    expect(hasCjkWord(`1.8${WJ}만`)).toBe(false);
    expect(hasCjkWord(`1.2${WJ}万${WJ}亿`)).toBe(false);
    expect(hasCjkWord("1.8만")).toBe(true);
    expect(hasCjkWord("2.1초")).toBe(true);
    expect(hasCjkWord("6月19日")).toBe(true);
    expect(hasCjkWord("キャッシュ")).toBe(true);
    expect(hasCjkWord("1:26 PM")).toBe(false);
  });
});
