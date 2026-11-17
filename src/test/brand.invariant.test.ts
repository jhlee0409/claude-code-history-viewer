import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/constants/brand";
import i18n from "@/i18n";

const ROOT = resolve(__dirname, "../..");
const LOCALES_DIR = join(ROOT, "src/i18n/locales");
const APP_NAME_REF = "$t(common.appName)";

// User-visible legacy display names. "Claude Code" alone is a supported
// provider name and must stay allowed.
const LEGACY_NAME_PATTERNS = [/Claude Code History/, /\bCode History\b/];

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(LOCALES_DIR, name, "common.json")));

function readLocaleNamespace(locale: string, file: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), "utf8"));
}

function localeFiles(locale: string): string[] {
  return readdirSync(join(LOCALES_DIR, locale)).filter((f) => f.endsWith(".json"));
}

// User-facing shell surfaces outside the locale bundles.
const SURFACE_FILES = ["index.html", "public/manifest.json"];

describe("brand invariants", () => {
  it("discovers every shipped locale", () => {
    expect(locales.length).toBeGreaterThanOrEqual(5);
  });

  it.each(locales)("%s: common.appName equals APP_NAME", (locale) => {
    expect(readLocaleNamespace(locale, "common.json")["common.appName"]).toBe(APP_NAME);
  });

  it.each(locales)("%s: no locale string carries a legacy display name", (locale) => {
    for (const file of localeFiles(locale)) {
      for (const [key, value] of Object.entries(readLocaleNamespace(locale, file))) {
        for (const pattern of LEGACY_NAME_PATTERNS) {
          expect(`${file}:${key}=${value}`).not.toMatch(pattern);
        }
      }
    }
  });

  it.each(SURFACE_FILES)("%s carries no legacy display name", (file) => {
    const content = readFileSync(join(ROOT, file), "utf8");
    for (const pattern of LEGACY_NAME_PATTERNS) {
      expect(content).not.toMatch(pattern);
    }
  });

  it.each(locales)("%s: strings referencing the app name resolve to APP_NAME", (locale) => {
    const t = i18n.getFixedT(locale);
    for (const file of localeFiles(locale)) {
      for (const [key, value] of Object.entries(readLocaleNamespace(locale, file))) {
        if (!value.includes(APP_NAME_REF)) continue;
        const resolved = t(key, { error: "E" });
        expect(resolved).toContain(APP_NAME);
        expect(resolved).not.toContain("$t(");
      }
    }
  });
});
