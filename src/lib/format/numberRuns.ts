/**
 * How <Num> (Num.tsx) cuts a formatter result: whether it holds a CJK word,
 * and its numbers with an inner separator.
 */

const CJK_LETTER = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** A compact number's CJK suffix as `formatNumber` joins it (`⁠만`, `⁠万⁠亿`). */
const JOINED_SUFFIX = /\u2060[\p{Script=Han}\p{Script=Hangul}](?:\u2060[\p{Script=Han}\p{Script=Hangul}])*/gu;

/**
 * A number with at least one inner separator (`.` `,` `:` `/`), with the sign,
 * comparison, currency, compact suffix or percent sign that belongs to it.
 */
const PUNCTUATED_NUMBER =
  /[<>~]?[+\-\u2212]?\$?\d+(?:[.,:/]\d+)+(?:[KMBT%]|(?:\u2060[\p{Script=Han}\p{Script=Hangul}])+)?/gu;

/** Whether `text` holds a CJK word: Han, Hangul or kana outside a compact number's joined suffix. */
export const hasCjkWord = (text: string): boolean => CJK_LETTER.test(text.replace(JOINED_SUFFIX, ""));

export interface NumberRun {
  text: string;
  /** A number with an inner separator, rendered as its own `[data-num]`. */
  num: boolean;
}

/** `text` cut into its punctuated numbers and the text around them; joined, the runs are `text`. */
export function numberRuns(text: string): NumberRun[] {
  const runs: NumberRun[] = [];
  let last = 0;
  for (const match of text.matchAll(PUNCTUATED_NUMBER)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), num: false });
    runs.push({ text: match[0], num: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), num: false });
  return runs;
}
