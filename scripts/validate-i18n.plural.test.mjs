// Plural-bundle awareness of the i18n validator (plan F4a).
//
// Keys `x_one` / `x_other` (and `_zero`, `_two`, `_few`, `_many`) form one
// plural bundle. Each locale needs exactly the forms its plural rules use
// (`Intl.PluralRules(lang).resolvedOptions().pluralCategories`): en one +
// other, ko / ja / zh-CN / zh-TW other only.
import { describe, expect, it } from "vitest";
import {
  compareLocaleKeys,
  pluralBundles,
  requiredPluralForms,
  splitPluralKey,
  typeKeys,
} from "./i18n-rules.mjs";

describe("requiredPluralForms", () => {
  it("follows CLDR for the five app locales", () => {
    expect(requiredPluralForms("en")).toEqual(["one", "other"]);
    for (const lang of ["ko", "ja", "zh-CN", "zh-TW"]) {
      expect(requiredPluralForms(lang), lang).toEqual(["other"]);
    }
  });
});

describe("splitPluralKey / pluralBundles", () => {
  it("recognises plural suffixes only at the end", () => {
    expect(splitPluralKey("message.count_one")).toEqual({ base: "message.count", form: "one" });
    expect(splitPluralKey("message.count_other")).toEqual({ base: "message.count", form: "other" });
    expect(splitPluralKey("message.count_zero")).toEqual({ base: "message.count", form: "zero" });
    expect(splitPluralKey("message.other")).toBeNull();
    expect(splitPluralKey("message.count")).toBeNull();
  });

  it("groups forms by base key", () => {
    const bundles = pluralBundles(["a_one", "a_other", "b_other", "c"]);
    expect([...bundles.keys()]).toEqual(["a", "b"]);
    expect([...(bundles.get("a") ?? [])]).toEqual(["one", "other"]);
  });
});

describe("compareLocaleKeys", () => {
  const en = ["plain", "files_one", "files_other"];

  it("passes ko with only _other for an en _one/_other bundle", () => {
    const out = compareLocaleKeys({ baseKeys: en, targetKeys: ["plain", "files_other"], lang: "ko" });
    expect(out.missing).toEqual([]);
    expect(out.missingPluralForms).toEqual([]);
    expect(out.extra).toEqual([]);
  });

  it("fails ko when the bundle is missing altogether", () => {
    const out = compareLocaleKeys({ baseKeys: en, targetKeys: ["plain"], lang: "ko" });
    expect(out.missingPluralForms).toEqual([{ base: "files", forms: ["other"] }]);
  });

  it("fails a locale that lacks a form its rules need", () => {
    const out = compareLocaleKeys({ baseKeys: en, targetKeys: ["plain", "files_one"], lang: "ko" });
    expect(out.missingPluralForms).toEqual([{ base: "files", forms: ["other"] }]);
  });

  it("checks the base locale against its own rules too", () => {
    const out = compareLocaleKeys({ baseKeys: ["files_other"], targetKeys: ["files_other"], lang: "en", baseLang: "en" });
    expect(out.missingPluralForms).toEqual([{ base: "files", forms: ["one"] }]);
  });

  it("reports forms a locale never uses as unused, not missing", () => {
    const out = compareLocaleKeys({ baseKeys: en, targetKeys: ["plain", "files_one", "files_other"], lang: "ja" });
    expect(out.missingPluralForms).toEqual([]);
    expect(out.unusedPluralForms).toEqual([{ base: "files", forms: ["one"] }]);
  });

  it("allows an optional _zero form in any locale", () => {
    const out = compareLocaleKeys({ baseKeys: en, targetKeys: ["plain", "files_zero", "files_other"], lang: "zh-CN" });
    expect(out.unusedPluralForms).toEqual([]);
    expect(out.missingPluralForms).toEqual([]);
  });

  it("still reports plain missing and extra keys", () => {
    const out = compareLocaleKeys({ baseKeys: en, targetKeys: ["files_other", "stray"], lang: "ko" });
    expect(out.missing).toEqual(["plain"]);
    expect(out.extra).toEqual(["stray"]);
  });

  it("treats a bundle present only in the target as extra", () => {
    const out = compareLocaleKeys({ baseKeys: ["plain"], targetKeys: ["plain", "ghost_other"], lang: "ko" });
    expect(out.extra).toEqual(["ghost_other"]);
  });
});

describe("typeKeys", () => {
  it("collapses a plural bundle into its base key", () => {
    expect(typeKeys(["a", "files_one", "files_other", "z_other"])).toEqual(["a", "files", "z"]);
  });
});
