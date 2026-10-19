import { describe, expect, it } from "vitest";
import { wordBreakRuns } from "@/components/mobile/tabLabelBreaks";

// A phone tab label wraps only between words (`break-keep`). CJK text has no
// spaces, so a compound like "セッションボード" offers no break at all; the
// label gets a break opportunity (<wbr>) between its words instead.
describe("wordBreakRuns", () => {
  it("splits a katakana compound into its words", () => {
    expect(wordBreakRuns("セッションボード", "ja")).toEqual(["セッション", "ボード"]);
  });

  it("keeps a single word whole", () => {
    expect(wordBreakRuns("プロジェクト", "ja")).toEqual(["プロジェクト"]);
    expect(wordBreakRuns("Messages", "en")).toEqual(["Messages"]);
  });

  it("leaves spaced text to the spaces (no extra break points)", () => {
    expect(wordBreakRuns("Session board", "en")).toEqual(["Session board"]);
    expect(wordBreakRuns("Claude Code 設定", "ja")).toEqual(["Claude Code 設定"]);
  });

  it("joins back to the same text", () => {
    for (const [text, locale] of [["セッションボード", "ja"], ["会话面板", "zh-CN"], ["세션 보드", "ko"]] as const) {
      expect(wordBreakRuns(text, locale).join("")).toBe(text);
    }
  });
});
