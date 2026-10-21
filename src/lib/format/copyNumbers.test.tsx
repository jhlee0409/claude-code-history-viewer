/**
 * Copying formatted numbers (F3b review 7): `formatNumber` joins a CJK compact
 * number to its suffix with U+2060 WORD JOINER so it never wraps (`1120⁠万`).
 * Copied from a numeric display, the number is the text `Intl` writes
 * (`1120万`); transcript, code and path text copies exactly as recorded, a
 * literal U+2060 included.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { copyNumbersPlain } from "./copyNumbers";
import { formatNumber, formatTokens, withoutNumberJoiners } from "./number";

const WJ = "\u2060";
const LANGUAGES = ["en", "ko", "ja", "zh-CN", "zh-TW"];

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

describe("withoutNumberJoiners", () => {
  it("removes every joiner formatNumber puts in: the text Intl writes", () => {
    const values = [12_345, 99_999, 1_234_567, 11_200_000, 123_456_789, 1.2e12, 9.87e15, -56_789, -1.2e9];
    for (const language of LANGUAGES) {
      for (const value of values) {
        const formatted = formatNumber(value, language, { style: "compact" });
        const plain = formatted.split(WJ).join("");
        expect(withoutNumberJoiners(formatted), `${language} ${value}`).toBe(plain);
        expect(withoutNumberJoiners(`合計 ${formatted} トークン`)).toBe(`合計 ${plain} トークン`);
      }
    }
    expect(withoutNumberJoiners(formatTokens(11_200_000, "ja"))).toBe("1120万");
    expect(withoutNumberJoiners(formatNumber(1.2e12, "zh-CN", { style: "compact" }))).toBe("1.2万亿");
  });

  it("keeps a U+2060 the formatter would not write", () => {
    for (const text of [
      `a${WJ}b`,
      `漢${WJ}字`,
      `${WJ}万`,
      `万${WJ}1`,
      `1${WJ}a`,
      `1${WJ}K`,
      `x${WJ}`,
      `${WJ}`,
      `1 ${WJ}万`,
    ]) {
      expect(withoutNumberJoiners(text), JSON.stringify(text)).toBe(text);
    }
  });
});

/** Selects the contents of `from` through `to` (default: `from` alone). */
function select(from: Node, to: Node = from) {
  const range = document.createRange();
  range.setStart(from, 0);
  range.setEnd(to, to.childNodes.length || (to.textContent ?? "").length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** A copy on `target` (the element the selection starts in): what the handlers put on the clipboard. */
function copy(target: Element) {
  const data = new Map<string, string>();
  const clipboardData = {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
  const notPrevented = fireEvent.copy(target, { clipboardData });
  return { prevented: !notPrevented, text: data.get("text/plain") };
}

describe("copyNumbersPlain: a numeric display copies its numbers as Intl writes them", () => {
  const JA_TOKENS = formatTokens(11_200_000, "ja");

  it("selecting and copying a compact CJK value gives 1120万, without U+2060", () => {
    expect(JA_TOKENS).toBe(`1120${WJ}万`); // what the screen shows (joined, unbreakable)
    render(
      <div onCopy={copyNumbersPlain}>
        <span>日平均トークン:</span> <span data-testid="value">{JA_TOKENS}</span>
      </div>,
    );
    const value = screen.getByTestId("value");
    select(value);
    expect(window.getSelection()!.toString()).toBe(`1120${WJ}万`);
    expect(copy(value)).toEqual({ prevented: true, text: "1120万" });
  });

  it("a selection over several values inside the display: every number, labels unchanged", () => {
    render(
      <dl data-testid="card" onCopy={copyNumbersPlain}>
        <dt>入力</dt>
        <dd>{formatTokens(18_000, "ja")}</dd>
        <dt>出力</dt>
        <dd>{formatTokens(501_300, "ja")}</dd>
      </dl>,
    );
    const card = screen.getByTestId("card");
    select(card);
    expect(copy(card.firstElementChild!)).toEqual({ prevented: true, text: "入力1.8万出力50.1万" });
  });

  it("a selection that cuts a number at its joiner leaves the cut-off joiner behind", () => {
    render(
      <div onCopy={copyNumbersPlain}>
        <span data-testid="value">{JA_TOKENS}</span>
      </div>,
    );
    const value = screen.getByTestId("value");
    const text = value.firstChild!;
    const selectText = (start: number, end: number) => {
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    };
    selectText(0, 5);
    expect(window.getSelection()!.toString()).toBe(`1120${WJ}`);
    expect(copy(value)).toEqual({ prevented: true, text: "1120" });
    selectText(4, 6);
    expect(window.getSelection()!.toString()).toBe(`${WJ}万`);
    expect(copy(value)).toEqual({ prevented: true, text: "万" });
  });

  it("transcript text with a literal U+2060 copies unchanged", () => {
    const recorded = `literal ${WJ} joiner, and 1120${WJ}万 as recorded`;
    render(
      <main>
        <div onCopy={copyNumbersPlain}>{JA_TOKENS}</div>
        <p data-testid="transcript">{recorded}</p>
      </main>,
    );
    const transcript = screen.getByTestId("transcript");
    select(transcript);
    expect(window.getSelection()!.toString()).toBe(recorded);
    expect(copy(transcript)).toEqual({ prevented: false, text: undefined }); // the browser's own copy
  });

  it("a selection that reaches outside the display copies as the browser would", () => {
    render(
      <main>
        <div onCopy={copyNumbersPlain}>
          <span data-testid="value">{JA_TOKENS}</span>
        </div>
        <p data-testid="transcript">{`recorded 1120${WJ}万`}</p>
      </main>,
    );
    const value = screen.getByTestId("value");
    select(value, screen.getByTestId("transcript"));
    expect(copy(value)).toEqual({ prevented: false, text: undefined });
  });

  it("leaves a copy another handler already took over (a path's full text)", () => {
    render(
      <div onCopy={copyNumbersPlain}>
        <span
          data-testid="path"
          onCopy={(event) => {
            event.clipboardData.setData("text/plain", "/full/path");
            event.preventDefault();
          }}
        >
          {`~/p${WJ}万 ${JA_TOKENS}`}
        </span>
      </div>,
    );
    const path = screen.getByTestId("path");
    select(path);
    expect(copy(path)).toEqual({ prevented: true, text: "/full/path" });
  });

  it("a selection without the formatter's joiners keeps the browser's copy (rich text included)", () => {
    render(
      <div onCopy={copyNumbersPlain}>
        <span data-testid="value">{formatTokens(11_200_000, "en")}</span>
      </div>,
    );
    const value = screen.getByTestId("value");
    select(value);
    expect(window.getSelection()!.toString()).toBe("11.2M");
    expect(copy(value)).toEqual({ prevented: false, text: undefined });
  });

  it("text typed in a field copies as typed", () => {
    render(
      <div onCopy={copyNumbersPlain}>
        <textarea data-testid="field" defaultValue={`1120${WJ}万`} />
      </div>,
    );
    const field = screen.getByTestId("field");
    select(field);
    expect(copy(field)).toEqual({ prevented: false, text: undefined });
  });
});
