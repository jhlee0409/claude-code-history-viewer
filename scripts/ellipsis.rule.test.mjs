// Copy-format rules of the i18n validator (plan F4a, audit G-MC3 / G-MC4):
// `{{count}}` needs a plural bundle, no `(s)`, no ASCII `...` in prose.
// Code and command literals are exempt: backtick spans inside a value, and
// keys on the code-literal list (a value that is a command example).
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAllowlist, collectCopyViolations, findCopyViolations, proseOf } from "./i18n-rules.mjs";

const rulesOf = (entries, options) => findCopyViolations(entries, options).map((v) => `${v.rule}:${v.key}`);

describe("proseOf", () => {
  it("drops backtick code spans", () => {
    expect(proseOf("Run `npm run dev...` first")).toBe("Run  first");
    expect(proseOf("no code")).toBe("no code");
  });
});

describe("ascii ellipsis", () => {
  it("fails prose with ...", () => {
    expect(rulesOf({ "common.loading": "Loading..." })).toEqual(["ascii-ellipsis:common.loading"]);
  });

  it("passes the typographic ellipsis", () => {
    expect(rulesOf({ "common.loading": "Loading…" })).toEqual([]);
  });

  it("passes a code literal inside backticks", () => {
    expect(rulesOf({ "x.hint": "Run `npm run dev...`" })).toEqual([]);
  });

  it("passes a key on the code-literal list", () => {
    expect(rulesOf({ "x.example": "npx -y server ..." }, { codeLiteralKeys: ["x.example"] })).toEqual([]);
  });

  it("still fails prose outside the backticks", () => {
    expect(rulesOf({ "x.hint": "Run `npm run dev` and wait..." })).toEqual(["ascii-ellipsis:x.hint"]);
  });
});

describe("parenthetical plural", () => {
  it("fails (s)", () => {
    expect(rulesOf({ "x.files": "{{n}} file(s) changed" })).toEqual(["parenthetical-plural:x.files"]);
  });

  it("ignores (s) inside code", () => {
    expect(rulesOf({ "x.regex": "Matches `file(s)`" })).toEqual([]);
  });
});

describe("count without plural", () => {
  it("fails {{count}} in a key that is not a plural form", () => {
    expect(rulesOf({ "x.sessions": "{{count}} sessions" })).toEqual(["count-without-plural:x.sessions"]);
    expect(rulesOf({ "x.sessions": "{{ count, number }} sessions" })).toEqual(["count-without-plural:x.sessions"]);
  });

  it("passes a plural bundle", () => {
    expect(rulesOf({ "x.sessions_one": "{{count}} session", "x.sessions_other": "{{count}} sessions" })).toEqual([]);
  });

  it("does not confuse other variables with count", () => {
    expect(rulesOf({ "x.total": "{{counted}} of {{total}}" })).toEqual([]);
  });

});

describe("count without plural, in every locale", () => {
  // ja / ko / zh have one plural form, `_other`; a `{{count}}` value still
  // has to live in a plural bundle there, not only in English.
  it("fails a ja value with {{count}} in a plain key, even when en is fine", () => {
    const out = collectCopyViolations({
      en: { "common.cancel": "Cancel" },
      ja: { "common.cancel": "{{count}} キャンセル" },
    });
    expect(out).toEqual([{ rule: "count-without-plural", key: "common.cancel", lang: "ja" }]);
  });

  it("passes a ja _other form", () => {
    const out = collectCopyViolations({
      en: { "x.files_one": "{{count}} file", "x.files_other": "{{count}} files" },
      ja: { "x.files_other": "{{count}} 件のファイル" },
      ko: { "x.files_other": "파일 {{count}}개" },
      "zh-CN": { "x.files_other": "{{count}} 个文件" },
    });
    expect(out).toEqual([]);
  });

  it("runs every rule for every locale", () => {
    const out = collectCopyViolations({
      ko: { a: "{{count}}개 file(s)...", "b_other": "{{count}}개" },
    });
    expect(out.map((v) => `${v.lang}:${v.rule}:${v.key}`)).toEqual([
      "ko:count-without-plural:a",
      "ko:parenthetical-plural:a",
      "ko:ascii-ellipsis:a",
    ]);
  });

  it("i18n:validate fails a new ja {{count}} value in a plain key (real script, copied locales)", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-count-"));
    try {
      fs.mkdirSync(path.join(tmp, "scripts"));
      for (const file of ["validate-i18n.mjs", "i18n-config.mjs", "i18n-rules.mjs", "i18n-copy-allowlist.json"]) {
        fs.copyFileSync(path.join(root, "scripts", file), path.join(tmp, "scripts", file));
      }
      fs.cpSync(path.join(root, "src/i18n/locales"), path.join(tmp, "src/i18n/locales"), { recursive: true });
      const run = () => {
        try {
          execFileSync(process.execPath, [path.join(tmp, "scripts/validate-i18n.mjs")], { stdio: "pipe" });
          return { code: 0, out: "" };
        } catch (e) {
          return { code: e.status, out: `${e.stdout}${e.stderr}` };
        }
      };
      expect(run().code).toBe(0);

      const jaCommon = path.join(tmp, "src/i18n/locales/ja/common.json");
      const data = JSON.parse(fs.readFileSync(jaCommon, "utf8"));
      data["common.cancel"] = "{{count}} キャンセル";
      fs.writeFileSync(jaCommon, JSON.stringify(data, null, 2));
      const result = run();
      expect(result.code).toBe(1);
      expect(result.out).toContain("ja: common.cancel — count-without-plural");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("checkAllowlist (ratchet)", () => {
  const violations = [
    { rule: "ascii-ellipsis", lang: "en", key: "a" },
    { rule: "ascii-ellipsis", lang: "ko", key: "a" },
  ];

  it("accepts violations that are on the starting allowlist", () => {
    const out = checkAllowlist(violations, { "ascii-ellipsis": { en: ["a"], ko: ["a"] } });
    expect(out.unlisted).toEqual([]);
    expect(out.stale).toEqual([]);
  });

  it("fails a new violation", () => {
    const out = checkAllowlist(violations, { "ascii-ellipsis": { en: ["a"] } });
    expect(out.unlisted).toEqual([{ rule: "ascii-ellipsis", lang: "ko", key: "a" }]);
  });

  it("fails an allowlist entry that no longer violates, so the list only shrinks", () => {
    const out = checkAllowlist([], { "ascii-ellipsis": { en: ["a"] } });
    expect(out.stale).toEqual([{ rule: "ascii-ellipsis", lang: "en", key: "a" }]);
  });
});
