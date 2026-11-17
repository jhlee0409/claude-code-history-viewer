/**
 * Num: a formatter result shown as text (inner-UI plan F1b, CJK wrapping).
 *
 * Every number, cost, size, share, duration, date and time from the shared
 * formatters (`useFormat()` / `appFormat()`) that a component renders as
 * text goes through it: `<Num>{fmt.tokens(n)}</Num>`, and so does a message
 * that interpolates one, once rendered: `<Num>{t("key", { n: fmt.count(x) })}</Num>`
 * (its words keep the language's breaking; only its numbers are shielded).
 * A component handed a formatter function (`formatTimeAgo={fmt.relative}`)
 * renders its calls the same way. The value handed to `t()`, attributes (`title`, `aria-label`) and data
 * stay plain strings. The guard in num.invariant.test.ts fails on a
 * formatter result rendered bare.
 *
 * Why: the Korean UI breaks text between words (`word-break: keep-all`,
 * base layer in src/index.css), and WebKit's keep-all also breaks after the
 * punctuation inside a number: `7,803` → `7,` / `803`, `1.8⁠만` → `1.` /
 * `8⁠만`, `$270.29`, `01:26:25`. It does so in a squeezed flex or grid item
 * (whose min-content width it lowers, ASCII text included) and, at any width,
 * in a text node that holds a non-Latin-1 character. Only `word-break: normal`
 * on the number's own element stops it; Unicode line breaking never breaks
 * inside a number. `overflow-wrap`, `line-break`, the font and a word joiner
 * after the separator do not (measured in WebKit).
 *
 * - Text without a CJK word (`7,803`, `1.8⁠만`, `<$0.01`, `>99%`, `1.4 MB`,
 *   `1:26 PM`, `3h 49m`) renders as one `<span data-num>`; the base layer
 *   gives `[data-num]` `word-break: normal`. A compact number's CJK suffix,
 *   joined to it by U+2060, is part of the number, not a word.
 * - Text with CJK words (`오후 1:26`, `2026년 6월 19일 오후 1:26:25`,
 *   `2.1초`, `下午1:26`) keeps the language's breaking for its words, which
 *   normal breaking would split anywhere (`오/후`). Only each number with an
 *   inner separator is a `[data-num]` span, inside a `<span data-num-text>`.
 *   Where such a number meets a glued word (`2.1` | `초`), no break appears:
 *   the keep-all side decides (measured in WebKit).
 *
 * The spans are inline and unstyled otherwise, so wherever nothing was split
 * nothing moves. Inside SVG `<text>`, which never wraps, a result stays bare.
 */
import { Fragment, type ReactElement } from "react";
import { hasCjkWord, numberRuns } from "./numberRuns";

export interface NumProps {
  /** A formatter result (or the text shown in its place, such as a dash). Empty renders nothing. */
  children: string | false | null | undefined;
}

export function Num({ children: text }: NumProps): ReactElement | null {
  if (!text) return null;
  if (!hasCjkWord(text)) return <span data-num="">{text}</span>;
  return (
    <span data-num-text="">
      {numberRuns(text).map((run, i) =>
        run.num ? (
          <span key={i} data-num="">
            {run.text}
          </span>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </span>
  );
}
