/**
 * Literal translation keys in source text, for the i18n key invariant test.
 *
 * Matches `t("key"…)` / `i18n.t('key'…)` / ``t(`key`…)`` whose first argument
 * is a plain string literal. Template literals with `${…}` and variables are
 * dynamic and skipped.
 */
const LITERAL_KEY_CALL = /(?<![\w$])t\(\s*(["'`])([A-Za-z0-9_.-]+)\1/g;

export function findLiteralKeys(code: string): string[] {
  return [...code.matchAll(LITERAL_KEY_CALL)].map((match) => match[2] as string);
}

/** A key is defined as itself or through i18next plural suffixes. */
export function isDefined(key: string, keys: Set<string>): boolean {
  if (keys.has(key)) return true;
  return ["_zero", "_one", "_two", "_few", "_many", "_other"].some((suffix) => keys.has(`${key}${suffix}`));
}
