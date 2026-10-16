/**
 * Every literal translation key the UI asks for exists in every locale.
 *
 * `t("analytics.reasoning", "Reasoning")` with no `analytics.reasoning` in the
 * locale files renders the English fallback in every language, so Korean
 * users read "REASONING" and "Unpriced models". `t("analytics.activeDays")`
 * with no key and no fallback renders the raw key. The rule pinned here:
 * a key written as a string literal in a `t(...)` call is defined in all five
 * locales (plural forms `_one` / `_other` count).
 *
 * KNOWN_MISSING lists keys that were already missing before this rule and
 * belong to other surfaces; it may only shrink. Each entry must still be
 * missing, so a fixed key has to leave the list.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLiteralKeys, isDefined } from "./i18nLiteralKeys";

const SRC = path.resolve(__dirname, "..");
const LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;

const KNOWN_MISSING = new Set([
  "assistantMessageDetails.cost",
  "assistantMessageDetails.duration",
  "assistantMessageDetails.reasoning",
  "assistantMessageDetails.tokenUsageLabel",
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

  it("counts plural forms as defined", () => {
    const keys = new Set(["c.items_one", "c.items_other", "c.plain"]);
    expect(isDefined("c.items", keys)).toBe(true);
    expect(isDefined("c.plain", keys)).toBe(true);
    expect(isDefined("c.missing", keys)).toBe(false);
  });
});

describe("literal i18n keys", () => {
  const files = sourceFiles(SRC);
  const used = new Map<string, Set<string>>();
  for (const file of files) {
    for (const key of findLiteralKeys(fs.readFileSync(file, "utf8"))) {
      if (!key.includes(".")) continue;
      const users = used.get(key) ?? new Set<string>();
      users.add(path.relative(SRC, file));
      used.set(key, users);
    }
  }

  it("scans the UI (sanity: finds hundreds of keys)", () => {
    expect(used.size).toBeGreaterThan(500);
  });

  for (const locale of LOCALES) {
    it(`every literal key is defined in ${locale}`, () => {
      const keys = localeKeys(locale);
      const missing = [...used.keys()]
        .filter((key) => !KNOWN_MISSING.has(key) && !isDefined(key, keys))
        .sort()
        .map((key) => `${key} (${[...(used.get(key) ?? [])].join(", ")})`);
      expect(missing).toEqual([]);
    });
  }

  it("KNOWN_MISSING only lists keys that are still missing and still used", () => {
    const en = localeKeys("en");
    const stale = [...KNOWN_MISSING].filter((key) => isDefined(key, en) || !used.has(key));
    expect(stale).toEqual([]);
  });
});
