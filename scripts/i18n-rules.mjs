/**
 * i18n rules shared by the validator, the type generator and their tests
 * (plan F4a). Pure functions: no file system, no process exit.
 *
 * Plural bundles: keys `x_zero`, `x_one`, `x_two`, `x_few`, `x_many`,
 * `x_other` form one bundle `x`, which i18next resolves from `t("x", { count })`.
 * A locale needs exactly the forms its CLDR plural rules use
 * (`Intl.PluralRules(lang).resolvedOptions().pluralCategories`): en one +
 * other, ko / ja / zh-CN / zh-TW other only. `_zero` is optional everywhere
 * (i18next uses it for count 0 when present).
 *
 * Copy rules (audit G-MC3 / G-MC4), checked on prose only — backtick spans
 * inside a value and keys on the code-literal list are code and stay as is:
 *   - count-without-plural: `{{count}}` in a key that is not a plural form
 *   - parenthetical-plural: `(s)` ("file(s)")
 *   - ascii-ellipsis: `...` (use `…`)
 * Existing violations sit on a starting allowlist that may only shrink.
 */

export const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];
const OPTIONAL_FORMS = new Set(["zero"]);
const PLURAL_KEY = new RegExp(`^(.+)_(${PLURAL_FORMS.join("|")})$`);

/** `{ base, form }` for a plural-form key, else `null`. */
export function splitPluralKey(key) {
  const match = PLURAL_KEY.exec(key);
  return match ? { base: match[1], form: match[2] } : null;
}

/** Plural forms a locale's rules use, in CLDR order. */
export function requiredPluralForms(lang) {
  const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
  return PLURAL_FORMS.filter((form) => categories.includes(form));
}

/** Map of bundle base → set of forms present, in first-seen order. */
export function pluralBundles(keys) {
  const bundles = new Map();
  for (const key of keys) {
    const plural = splitPluralKey(key);
    if (!plural) continue;
    if (!bundles.has(plural.base)) bundles.set(plural.base, new Set());
    bundles.get(plural.base).add(plural.form);
  }
  return bundles;
}

const sorted = (values) => [...values].sort();

/**
 * Compare a locale's keys with the base locale's, bundle-aware.
 *
 * - `missing` / `extra`: plain keys (and whole bundles the base lacks) as before.
 * - `missingPluralForms`: a base bundle without a form this locale needs —
 *   including a bundle that is absent altogether. Error.
 * - `unusedPluralForms`: forms this locale's rules never select (ko `_one`).
 *   Harmless dead strings; a warning.
 *
 * Pass `baseLang` equal to `lang` to check the base locale against its own
 * rules.
 */
export function compareLocaleKeys({ baseKeys, targetKeys, lang }) {
  const baseList = [...baseKeys];
  const targetList = [...targetKeys];
  const baseBundles = pluralBundles(baseList);
  const targetBundles = pluralBundles(targetList);
  const isPlural = (key) => splitPluralKey(key) !== null;

  const basePlain = new Set(baseList.filter((key) => !isPlural(key)));
  const targetPlain = new Set(targetList.filter((key) => !isPlural(key)));

  const missing = sorted([...basePlain].filter((key) => !targetPlain.has(key)));
  const extra = sorted([
    ...[...targetPlain].filter((key) => !basePlain.has(key)),
    ...targetList.filter((key) => {
      const plural = splitPluralKey(key);
      return plural !== null && !baseBundles.has(plural.base);
    }),
  ]);

  const required = requiredPluralForms(lang);
  const missingPluralForms = [];
  const unusedPluralForms = [];
  for (const base of sorted(baseBundles.keys())) {
    const have = targetBundles.get(base) ?? new Set();
    const lacking = required.filter((form) => !have.has(form));
    if (lacking.length > 0) missingPluralForms.push({ base, forms: lacking });
    const unused = PLURAL_FORMS.filter((form) => have.has(form) && !required.includes(form) && !OPTIONAL_FORMS.has(form));
    if (unused.length > 0) unusedPluralForms.push({ base, forms: unused });
  }

  return { missing, extra, missingPluralForms, unusedPluralForms };
}

/** Keys for the generated `TranslationKey` type: one base key per plural bundle. */
export function typeKeys(keys) {
  const out = new Set();
  for (const key of keys) out.add(splitPluralKey(key)?.base ?? key);
  return sorted(out);
}

// ---------------------------------------------------------------------------
// Copy rules
// ---------------------------------------------------------------------------

export const COPY_RULES = ["count-without-plural", "parenthetical-plural", "ascii-ellipsis"];

/** The value with backtick code spans removed. */
export function proseOf(value) {
  return value.replace(/`[^`]*`/g, "");
}

const COUNT_VAR = /\{\{\s*count\s*(?:,[^}]*)?\}\}/;
const PAREN_PLURAL = /\w\(s\)/i;
const ASCII_ELLIPSIS = /\.\.\./;

/**
 * Copy-rule violations in one locale's `{ key: value }` table.
 * `codeLiteralKeys`: keys whose whole value is code (exempt from prose rules).
 * `rules`: which rules to run (default: all).
 */
export function findCopyViolations(entries, { codeLiteralKeys = [], rules = COPY_RULES } = {}) {
  const code = new Set(codeLiteralKeys);
  const out = [];
  for (const key of Object.keys(entries).sort()) {
    const value = entries[key];
    if (typeof value !== "string" || code.has(key)) continue;
    const prose = proseOf(value);
    if (rules.includes("count-without-plural") && COUNT_VAR.test(prose) && !splitPluralKey(key)) {
      out.push({ rule: "count-without-plural", key });
    }
    if (rules.includes("parenthetical-plural") && PAREN_PLURAL.test(prose)) {
      out.push({ rule: "parenthetical-plural", key });
    }
    if (rules.includes("ascii-ellipsis") && ASCII_ELLIPSIS.test(prose)) {
      out.push({ rule: "ascii-ellipsis", key });
    }
  }
  return out;
}

/**
 * Copy-rule violations (`{ rule, lang, key }`) of every locale, every rule
 * applied to every locale's own values. A `{{count}}` in a ja / ko / zh value
 * needs a plural bundle (`_other`) just as an English one does: key sync
 * proves the keys match, not what the translated values contain.
 */
export function collectCopyViolations(dataByLang, { codeLiteralKeys = [] } = {}) {
  const out = [];
  for (const [lang, entries] of Object.entries(dataByLang)) {
    for (const v of findCopyViolations(entries, { codeLiteralKeys })) out.push({ ...v, lang });
  }
  return out;
}

/**
 * Ratchet check of violations (`{ rule, lang, key }`) against the allowlist
 * (`{ [rule]: { [lang]: key[] } }`).
 * - `unlisted`: new violations → error.
 * - `stale`: listed entries that no longer violate → error (prune the list).
 */
export function checkAllowlist(violations, allowlist) {
  const id = (v) => `${v.rule}\u0000${v.lang}\u0000${v.key}`;
  const found = new Set(violations.map(id));
  const listed = [];
  for (const [rule, byLang] of Object.entries(allowlist ?? {})) {
    for (const [lang, keys] of Object.entries(byLang ?? {})) {
      for (const key of keys) listed.push({ rule, lang, key });
    }
  }
  const listedIds = new Set(listed.map(id));
  return {
    unlisted: violations.filter((v) => !listedIds.has(id(v))),
    stale: listed.filter((v) => !found.has(id(v))),
  };
}

/** The allowlist with stale entries removed (never adds). */
export function pruneAllowlist(violations, allowlist) {
  const { stale } = checkAllowlist(violations, allowlist);
  const staleIds = new Set(stale.map((v) => `${v.rule}\u0000${v.lang}\u0000${v.key}`));
  const out = {};
  for (const [rule, byLang] of Object.entries(allowlist ?? {})) {
    for (const [lang, keys] of Object.entries(byLang ?? {})) {
      const kept = keys.filter((key) => !staleIds.has(`${rule}\u0000${lang}\u0000${key}`));
      if (kept.length === 0) continue;
      out[rule] ??= {};
      out[rule][lang] = kept;
    }
  }
  return out;
}
