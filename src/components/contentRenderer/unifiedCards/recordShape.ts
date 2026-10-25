/**
 * The record checks of the Default path's structured bodies (TR1a fix
 * round 1; the rule is in `toolBodies.tsx`): the shape a body's input must
 * have, and what of a record a body leaves unshown (the "other recorded
 * fields" JSON).
 */

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

/** The body shows the value only when `shows(value)`; otherwise the value stays unshown, whole. */
export const shownIf =
  (shows: Check): Unshown =>
  (value) =>
    shows(value) ? undefined : value;

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
