/**
 * The copy boundary of a numeric display (F3b review 7).
 *
 * `formatNumber` keeps a CJK compact number on one line by joining numeral
 * and suffix with U+2060 WORD JOINER (`1120⁠万`). On screen it is invisible;
 * copied as is, the pasted `1120万` would miss a plain-text search or a
 * parser. A display of formatted numbers (the analytics screens, the
 * Inspector's Tokens tab, the transcript's token counts) spreads
 * `numberCopyBoundary`, whose `onCopy` is `copyNumbersPlain`.
 *
 * Scoped on purpose, never global: a transcript, code or a path copies exactly
 * as recorded, a literal U+2060 included. So the handler changes a copy only
 * when the whole selection lies inside the element it is attached to, and
 * then removes only the joiners the formatter writes (`withoutNumberJoiners`).
 */
import type { ClipboardEvent } from "react";
import { withoutNumberJoiners } from "./number";

const isEditable = (target: EventTarget) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/**
 * `onCopy` of an element that shows formatted numbers: when the selection
 * lies wholly inside it, the copied text is the selection with the
 * formatter's joiners removed. A selection that reaches outside the element,
 * a copy another handler already took over (PathText's full path), text typed
 * in a field and a selection without such joiners copy as the browser would.
 */
export function copyNumbersPlain(event: ClipboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || isEditable(event.target)) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const boundary = event.currentTarget;
  for (let i = 0; i < selection.rangeCount; i++) {
    if (!boundary.contains(selection.getRangeAt(i).commonAncestorContainer)) return;
  }
  const text = selection.toString();
  // A selection can also end between a numeral and its joiner, or start
  // between the joiner and the suffix (`1120⁠` of `1120⁠万`); the formatter
  // never puts a joiner at either end of a number, so one there is cut off.
  const plain = withoutNumberJoiners(text).replace(CUT_AFTER_NUMERAL, "$1").replace(CUT_BEFORE_SUFFIX, "");
  if (plain === text) return;
  event.clipboardData.setData("text/plain", plain);
  event.preventDefault();
}

// No lookbehind: WKWebView before Safari 16.4 cannot parse one (webviewRegex.guard).
const CUT_AFTER_NUMERAL = /(\d)\u2060$/u;
const CUT_BEFORE_SUFFIX = /^\u2060(?=[\p{Script=Han}\p{Script=Hangul}])/u;

/**
 * Spread on the element of a numeric display: its copy handler and the hook
 * the browser tests find every boundary by (`[data-number-copy]`).
 */
export const numberCopyBoundary = { onCopy: copyNumbersPlain, "data-number-copy": "" } as const;
