/**
 * Every literal translation key the UI asks for exists in every locale.
 *
 * `t("analytics.reasoning", "Reasoning")` with no `analytics.reasoning` in the
 * locale files renders the English fallback in every language, so Korean
 * users read "REASONING" and "Unpriced models". `t("analytics.activeDays")`
 * with no key and no fallback renders the raw key. The rule pinned here:
 * a key written as a string literal in a `t(...)` call is defined in all five
 * locales. A call that passes `count` may use the plural forms instead
 * (every form the locale's plural rules need, e.g. en `_one` + `_other`,
 * ko `_other`); a call without `count` needs the key itself.
 *
 * KNOWN_MISSING lists keys that were already missing before this rule and
 * belong to other surfaces; it may only shrink. Each entry must still be
 * missing, so a fixed key has to leave the list.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLiteralKeyCalls, findLiteralKeys, isDefined } from "./i18nLiteralKeys";

const SRC = path.resolve(__dirname, "..");
const LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;

const KNOWN_MISSING = new Set([
  "common.provider.filterApplyError",
  "error.invalidPresetMcpServers",
  "error.invalidPresetSettings",
  "feedback.description",
  "session.actions",
  "session.copyResumeCommandError",
  "session.deleteConfirmForgeCode",
  "session.deleteTarget",
]);

function localeKeys(locale: string): Set<string> {
  const dir = path.join(SRC, "i18n", "locales", locale);
  const keys = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(json)) keys.add(key);
  }
  return keys;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Locale files and the i18n setup itself (whose doc comments show
      // placeholder keys) are not UI call sites; tests use made-up keys.
      if (full === path.join(SRC, "i18n") || entry.name === "__tests__" || entry.name === "test") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("findLiteralKeys", () => {
  it("finds literal keys with and without a fallback, and skips dynamic ones", () => {
    const code = [
      `t("a.one")`,
      `t('a.two', "Fallback")`,
      "t(`a.three`)",
      `i18n.t("a.four", { count: 2 })`,
      "t(`a.${dynamic}`)",
      `t(variable)`,
      `format("not.a.key")`,
      `const at = ("x.y")`,
    ].join("\n");
    expect(findLiteralKeys(code)).toEqual(["a.one", "a.two", "a.three", "a.four"]);
  });

  it("finds calls with whitespace before the parenthesis", () => {
    const code = [`t ("a.one")`, `i18n.t\t( 'a.two', "Fallback")`, "t\n(`a.three`)", `at ("not.a.key")`].join("\n");
    expect(findLiteralKeys(code)).toEqual(["a.one", "a.two", "a.three"]);
  });

  it("records whether the call passes a count", () => {
    const code = [
      `t("a.one", { count: 2 })`,
      `t("a.two", "Fallback", { count })`,
      `t("a.three", { n: f(x, y), count: total })`,
      `t("a.four", { name })`,
      `t("a.five")`,
      `t("a.six", { name: "count:" }), count`,
    ].join("\n");
    expect(findLiteralKeyCalls(code)).toEqual([
      { key: "a.one", hasCount: true },
      { key: "a.two", hasCount: true },
      { key: "a.three", hasCount: true },
      { key: "a.four", hasCount: false },
      { key: "a.five", hasCount: false },
      { key: "a.six", hasCount: false },
    ]);
  });
});

describe("isDefined", () => {
  const withCount = (locale: string) => ({ locale, hasCount: true });
  const withoutCount = (locale: string) => ({ locale, hasCount: false });

  it("a plain key is defined with or without a count (i18next falls back to it)", () => {
    const keys = new Set(["c.plain"]);
    expect(isDefined("c.plain", keys, withoutCount("en"))).toBe(true);
    expect(isDefined("c.plain", keys, withCount("en"))).toBe(true);
    expect(isDefined("c.missing", keys, withoutCount("en"))).toBe(false);
    expect(isDefined("c.missing", keys, withCount("en"))).toBe(false);
  });

  it("with a count, every plural form the locale uses must exist", () => {
    // English needs one + other; Korean needs only other.
    expect(isDefined("c.items", new Set(["c.items_one", "c.items_other"]), withCount("en"))).toBe(true);
    expect(isDefined("c.items", new Set(["c.items_one"]), withCount("en"))).toBe(false);
    expect(isDefined("c.items", new Set(["c.items_other"]), withCount("en"))).toBe(false);
    expect(isDefined("c.items", new Set(["c.items_other"]), withCount("ko"))).toBe(true);
    expect(isDefined("c.items", new Set(["c.items_one"]), withCount("ko"))).toBe(false);
  });

  it("without a count, plural-only entries do not define the key", () => {
    const keys = new Set(["c.items_one", "c.items_other"]);
    expect(isDefined("c.items", keys, withoutCount("en"))).toBe(false);
    expect(isDefined("c.items", keys, withoutCount("ko"))).toBe(false);
  });
});

describe("literal i18n keys", () => {
  type Usage = { files: Set<string>; withCount: boolean; withoutCount: boolean };
  const files = sourceFiles(SRC);
  const used = new Map<string, Usage>();
  for (const file of files) {
    for (const { key, hasCount } of findLiteralKeyCalls(fs.readFileSync(file, "utf8"))) {
      if (!key.includes(".")) continue;
      const usage = used.get(key) ?? { files: new Set<string>(), withCount: false, withoutCount: false };
      usage.files.add(path.relative(SRC, file));
      if (hasCount) usage.withCount = true;
      else usage.withoutCount = true;
      used.set(key, usage);
    }
  }

  /** Defined for every way the UI calls it: with a count and/or without. */
  const definedIn = (key: string, keys: Set<string>, locale: string): boolean => {
    const usage = used.get(key);
    if (!usage) return isDefined(key, keys, { locale, hasCount: false });
    return (
      (!usage.withCount || isDefined(key, keys, { locale, hasCount: true })) &&
      (!usage.withoutCount || isDefined(key, keys, { locale, hasCount: false }))
    );
  };

  it("scans the UI (sanity: finds hundreds of keys)", () => {
    expect(used.size).toBeGreaterThan(500);
  });

  for (const locale of LOCALES) {
    it(`every literal key is defined in ${locale}`, () => {
      const keys = localeKeys(locale);
      const missing = [...used.keys()]
        .filter((key) => !KNOWN_MISSING.has(key) && !definedIn(key, keys, locale))
        .sort()
        .map((key) => `${key} (${[...(used.get(key)?.files ?? [])].join(", ")})`);
      expect(missing).toEqual([]);
    });
  }

  it("KNOWN_MISSING only lists keys that are still missing and still used", () => {
    const en = localeKeys("en");
    const stale = [...KNOWN_MISSING].filter((key) => definedIn(key, en, "en") || !used.has(key));
    expect(stale).toEqual([]);
  });
});
