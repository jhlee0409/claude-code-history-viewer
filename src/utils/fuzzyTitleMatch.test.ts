import { describe, it, expect } from "vitest";
import { compileFuzzyTitleQuery, fuzzyTitleMatches, splitTitleWords } from "./fuzzyTitleMatch";

const matches = (query: string, title: string): boolean => {
  const compiled = compileFuzzyTitleQuery(query);
  return compiled !== null && fuzzyTitleMatches(compiled, title);
};

describe("fuzzyTitleMatch", () => {
  it("splits titles into lowercased words, including camelCase", () => {
    expect(splitTitleWords("claude-code_history.viewer")).toEqual(["claude", "code", "history", "viewer"]);
    expect(splitTitleWords("HistoryViewer v2 (draft)")).toEqual(["history", "viewer", "v2", "draft"]);
    expect(splitTitleWords("세션 이름 정리")).toEqual(["세션", "이름", "정리"]);
  });

  it("gives queries under 3 letters no fuzzy matching", () => {
    expect(compileFuzzyTitleQuery("cc")).toBeNull();
    expect(compileFuzzyTitleQuery("c-c")).toBeNull();
    expect(compileFuzzyTitleQuery("cch")).not.toBeNull();
  });

  describe("abbreviations", () => {
    it("matches word initials and word prefixes of consecutive words", () => {
      expect(matches("cchv", "claude-code-history-viewer")).toBe(true);
      expect(matches("clcohi", "claude-code-history-viewer")).toBe(true);
      expect(matches("hisview", "claude-code-history-viewer")).toBe(true);
      expect(matches("hv", "claude-code-history-viewer")).toBe(false); // too short
      expect(matches("hvw", "HistoryViewerWeb")).toBe(true);
    });

    it("needs consecutive words, in order", () => {
      expect(matches("ccv", "claude-code-history-viewer")).toBe(false);
      expect(matches("vhcc", "claude-code-history-viewer")).toBe(false);
    });

    it("does not match a piece from the middle of a word", () => {
      expect(matches("lcv", "claude-code-viewer")).toBe(false);
    });

    it("starts a new word at a separator in the query", () => {
      expect(matches("hist view", "history viewer")).toBe(true);
      expect(matches("cc hv", "claude-code-history-viewer")).toBe(true);
      expect(matches("claudec", "claude code")).toBe(true);
      // The space makes "dec" a word of its own, which no title word starts with.
      expect(matches("clau dec", "claude code")).toBe(false);
    });

    it("backtracks when the longest prefix is the wrong split", () => {
      // Taking all of "coco" leaves "nf", so the search falls back to "co" + "conf".
      expect(matches("coconf", "coco config")).toBe(true);
      expect(matches("ccon", "code config")).toBe(true);
    });
  });

  describe("query words in any order, one typo", () => {
    it("finds every query word, in any order", () => {
      expect(matches("bug login", "Fix login bug")).toBe(true);
      expect(matches("bug signup", "Fix login bug")).toBe(false);
    });

    it("tolerates one typo in words of 4+ characters", () => {
      expect(matches("histroy", "Refactor history page")).toBe(true); // swap
      expect(matches("hstory", "Refactor history page")).toBe(true); // missing
      expect(matches("hisstory", "Refactor history page")).toBe(true); // extra
      expect(matches("histary", "Refactor history page")).toBe(true); // wrong
      expect(matches("lgoin bug", "Fix login bug")).toBe(true);
    });

    it("tolerates a typo against the start of a longer word, as the user types", () => {
      expect(matches("hsit", "Refactor history page")).toBe(true);
      expect(matches("confg", "Shell configuration")).toBe(true);
    });

    it("does not tolerate two typos or typos in short words", () => {
      expect(matches("hsitroy", "Refactor history page")).toBe(false);
      expect(matches("bgu", "Fix login bug")).toBe(false);
      // The compared start of the title word must be 4+ characters too.
      expect(matches("hist", "his notes")).toBe(false);
    });
  });
});
