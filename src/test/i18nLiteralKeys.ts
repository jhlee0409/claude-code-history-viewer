/**
 * Literal translation keys in source text, for the i18n key invariant test.
 *
 * Matches `t("key"…)` / `i18n.t('key'…)` / ``t(`key`…)`` (whitespace allowed
 * before the parenthesis) whose first argument is a plain string literal.
 * Template literals with `${…}` and variables are dynamic and skipped.
 */
const LITERAL_KEY_CALL = /(?<![\w$])t\s*\(\s*(["'`])([A-Za-z0-9_.-]+)\1/g;

/** String literals, so a "count" inside one is not read as an option. */
const STRING_LITERAL = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;
/** `count:` or the `{ count }` shorthand in the call's options. */
const COUNT_OPTION = /(?<![\w$.])count\s*(?=[:,}])/;
/** Longest call tail examined; real `t(...)` calls are far shorter. */
const MAX_CALL_LENGTH = 2000;

export type LiteralKeyCall = {
  key: string;
  /** The call passes a `count` option, so i18next resolves a plural form. */
  hasCount: boolean;
};

/** The call's arguments after the key, up to its closing parenthesis. */
function remainingArguments(code: string, from: number): string {
  const rest = code.slice(from, from + MAX_CALL_LENGTH).replace(STRING_LITERAL, '""');
  let depth = 1;
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i];
    if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") depth--;
    if (depth === 0) return rest.slice(0, i);
  }
  return rest;
}

export function findLiteralKeyCalls(code: string): LiteralKeyCall[] {
  return [...code.matchAll(LITERAL_KEY_CALL)].map((match) => ({
    key: match[2] as string,
    hasCount: COUNT_OPTION.test(remainingArguments(code, (match.index ?? 0) + match[0].length)),
  }));
}

export function findLiteralKeys(code: string): string[] {
  return findLiteralKeyCalls(code).map((call) => call.key);
}

/**
 * Whether `keys` (one locale's keys) can render a call to `key`.
 *
 * Without a count, i18next looks up the key itself. With a count it looks up
 * `key_<form>` for the form the locale's plural rules pick (en: one / other;
 * ko, ja, zh: other) and falls back to the key itself, so either the plain
 * key or every form the locale uses must exist.
 */
export function isDefined(
  key: string,
  keys: Set<string>,
  usage: { locale: string; hasCount: boolean },
): boolean {
  if (keys.has(key)) return true;
  if (!usage.hasCount) return false;
  const forms = new Intl.PluralRules(usage.locale).resolvedOptions().pluralCategories;
  return forms.every((form) => keys.has(`${key}_${form}`));
}
