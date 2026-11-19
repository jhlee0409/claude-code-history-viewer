/**
 * Every plural bundle renders in all five locales for count 0, 1 and 2
 * through the real i18next instance (plan F4a, D16).
 *
 * The validator checks that each locale has the forms its plural rules need;
 * this test checks that i18next actually picks them: en uses `_one` for 1 and
 * `_other` for 0 and 2, ko / ja / zh-CN / zh-TW always `_other` (an optional
 * `_zero` wins for 0). A missing form would fall back to English or render
 * the raw key; both fail here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";

const LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;
const LOCALES_DIR = path.resolve(__dirname, "locales");
const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;

function strings(locale: string): Record<string, string> {
  const dir = path.join(LOCALES_DIR, locale);
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  }
  return out;
}

const en = strings("en");
const bundles = [...new Set(Object.keys(en).flatMap((key) => PLURAL.exec(key)?.[1] ?? []))].sort();

/** Fill every `{{var}}` but count with a marker, as a caller would. */
const varsOf = (value: string) =>
  Object.fromEntries(
    [...value.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)]
      .map((m) => m[1] ?? "")
      .filter((name) => name !== "count")
      .map((name) => [name, `<${name}>`]),
  );

const interpolate = (value: string, count: number) =>
  value.replace(/\{\{\s*([\w.]+)[^}]*\}\}/g, (_, name: string) => (name === "count" ? String(count) : `<${name}>`));

describe("plural bundles render in every locale", () => {
  it("finds the plural bundles to check", () => {
    expect(bundles.length).toBeGreaterThan(0);
  });

  for (const locale of LOCALES) {
    const table = strings(locale);
    const rules = new Intl.PluralRules(locale);
    const t = i18n.getFixedT(locale);

    it.each(bundles)(`${locale}: %s for count 0, 1, 2`, (base) => {
      for (const count of [0, 1, 2]) {
        const form = count === 0 && table[`${base}_zero`] !== undefined ? "zero" : rules.select(count);
        const source = table[`${base}_${form}`];
        expect(source, `${locale} ${base}_${form}`).toBeTypeOf("string");
        const anyForm = Object.keys(table).find((k) => k.startsWith(`${base}_`)) ?? base;
        const rendered = t(base, { count, ...varsOf(table[anyForm] ?? "") });
        expect(rendered, `${locale} ${base} count=${count}`).toBe(interpolate(source ?? "", count));
        expect(rendered).not.toContain("{{");
      }
    });
  }

  it("uses the singular form for 1 and the plural for 0 and 2 in English", () => {
    const t = i18n.getFixedT("en");
    expect(t("message.count", { count: 1 })).toBe("1 message");
    expect(t("message.count", { count: 0 })).toBe("0 messages");
    expect(t("message.count", { count: 2 })).toBe("2 messages");
  });
});
