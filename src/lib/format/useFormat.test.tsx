import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { appFormat, formatterFor, useFormat } from "./useFormat";

/** U+2060 WORD JOINER between a numeral and its CJK suffix (number.ts). */
const WJ = "\u2060";

describe("useFormat", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("follows the app language and updates when it changes", async () => {
    await i18n.changeLanguage("en");
    const { result } = renderHook(() => useFormat());
    expect(result.current.tokens(59_427_870)).toBe("59.4M");
    expect(result.current.minutes(229)).toBe("3h 49m");

    await act(async () => {
      await i18n.changeLanguage("ko");
    });
    expect(result.current.language).toBe("ko");
    expect(result.current.tokens(59_427_870)).toBe(`5940${WJ}만`);
    expect(result.current.minutes(229)).toBe("3시간 49분");
  });

  it("appFormat reads the current language on each call", async () => {
    await i18n.changeLanguage("ja");
    expect(appFormat().tokens(59_427_870)).toBe(`5940${WJ}万`);
    await i18n.changeLanguage("en");
    expect(appFormat().tokens(59_427_870)).toBe("59.4M");
  });

  it("binds every formatter to one language", () => {
    const zh = formatterFor("zh-TW");
    expect(zh.tokens(59_427_870)).toBe(`5940${WJ}萬`);
    expect(zh.cost(0.004)).toBe("<$0.01");
    expect(zh.percent(0.453)).toBe("45%");
    expect(zh.count(1_369)).toBe("1,369");
  });
});
