/**
 * The record checks of the Default path's structured bodies (TR1a fix
 * rounds 1–2; the rule is in `toolBodies.tsx`): the shape a body's input
 * must have, and what of a record a body leaves unshown (the "other
 * recorded fields" JSON) — including, while the search query hits it, a
 * value the body shows only in another form (`shownAs`).
 */
import { searchRanges } from "@/components/common/searchMarks";

export type Check = (value: unknown) => boolean;

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isString: Check = (value) => typeof value === "string";
export const isNumber: Check = (value) => typeof value === "number";
export const isStringArray: Check = (value) => Array.isArray(value) && value.every(isString);
export const isNonEmptyString: Check = (value) => typeof value === "string" && value.length > 0;
export const isNonEmptyArray: Check = (value) => Array.isArray(value) && value.length > 0;

/** Every listed field is absent from `record` or passes its check (`Object.hasOwn`: a key named `constructor` is data). */
export const fieldsFit = (record: Record<string, unknown>, checks: Readonly<Record<string, Check>>): boolean =>
  Object.entries(checks).every(([key, check]) => !Object.hasOwn(record, key) || check(record[key]));

/** For one recorded key: what of its value the body leaves unshown, `undefined` when it shows all of it. */
export type Unshown = (value: unknown) => unknown;

/** The body shows the value whole. */
export const SHOWN: Unshown = () => undefined;

/** The body shows the value only when `shows(value)` (and then as `then` says); otherwise the value stays unshown, whole. */
export const shownIf =
  (shows: Check, then: Unshown = SHOWN): Unshown =>
  (value) =>
    shows(value) ? then(value) : value;

/**
 * A value the body shows in another form than its recorded text: a status
 * as an icon or a translated label, a path relative to a base; `display`
 * gives the text shown for it. It counts as shown only where that text holds
 * the recorded text verbatim. Otherwise, while `searchQuery` hits the
 * recorded value (the rule the marks use), the value stays unshown, so the
 * "other recorded fields" JSON shows it and marks the hit. No query or no
 * hit there: shown, the JSON is as before.
 */
export const shownAs =
  (display: (value: unknown) => string, searchQuery: string | undefined): Unshown =>
  (value) => {
    const recorded = typeof value === "string" ? value : JSON.stringify(value);
    if (display(value).includes(recorded)) return undefined;
    return searchQuery !== undefined && searchRanges(recorded, searchQuery).length > 0 ? value : undefined;
  };

/**
 * An array whose members the body shows field by field: per member, what it
 * leaves unshown (positions kept, `{}` = that member is shown whole);
 * `undefined` when every member is shown whole.
 */
export const unshownMembers =
  (unshownOf: (member: Record<string, unknown>) => Record<string, unknown>): Unshown =>
  (value) => {
    const rests = (value as Record<string, unknown>[]).map(unshownOf);
    return rests.some((rest) => Object.keys(rest).length > 0) ? rests : undefined;
  };

/**
 * The recorded values a body does not show, in recorded key order: a key
 * listed in `shown` keeps what its `Unshown` returns (nothing when that is
 * `undefined`); every other key stays whole. Built with `fromEntries`, so a
 * recorded `__proto__` key stays a plain field.
 */
export function unshown(record: Record<string, unknown>, shown: Readonly<Record<string, Unshown>>): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(record)) {
    const rest = Object.hasOwn(shown, key) ? (shown[key] as Unshown)(value) : value;
    if (rest !== undefined) entries.push([key, rest]);
  }
  return Object.fromEntries(entries);
}
