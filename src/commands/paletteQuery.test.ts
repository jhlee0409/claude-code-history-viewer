import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { COMMAND_MANIFEST } from "./manifest";
import { matchesCommandQuery } from "./paletteQuery";

const LANGUAGES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;

describe("a pasted command title finds its command (T7 re-review F3)", () => {
  it("a title ending in an ellipsis matches itself", () => {
    expect(matchesCommandQuery("Send Feedback…", "Send Feedback…", "help.feedback")).toBe(true);
    expect(matchesCommandQuery("Check for Updates…", "Check for Updates…", "app.checkForUpdates")).toBe(true);
    expect(matchesCommandQuery("Send Feedback...", "Send Feedback…", "help.feedback")).toBe(true);
    expect(matchesCommandQuery("feedback…", "Send Feedback…", "help.feedback")).toBe(true);
  });

  it("a mixed-case word matches the same word in the title", () => {
    expect(matchesCommandQuery("macOS", "Open in macOS Finder", "file.reveal")).toBe(true);
    expect(matchesCommandQuery("macos", "Open in macOS Finder", "file.reveal")).toBe(true);
  });

  it.each(LANGUAGES)("%s: every palette command's full title matches that command", (lng) => {
    const t = i18n.getFixedT(lng);
    const misses = COMMAND_MANIFEST.filter((entry) => entry.palette !== false)
      .map((entry) => ({ id: entry.id, title: t(entry.labelKey) }))
      .filter(({ id, title }) => !matchesCommandQuery(title, title, id));
    expect(misses).toEqual([]);
  });
});

describe("matchesCommandQuery", () => {
  it("matches every query word against the start of a title word", () => {
    expect(matchesCommandQuery("sett", "Open Settings Manager", "go.settingsManager")).toBe(true);
    expect(matchesCommandQuery("open arch", "Open Archive Manager", "go.archive")).toBe(true);
    expect(matchesCommandQuery("ettings", "Open Settings Manager", "go.settingsManager")).toBe(false);
  });

  it("matches the id's words too", () => {
    expect(matchesCommandQuery("minimap", "Show or Hide Session Minimap", "view.toggleMinimap")).toBe(true);
    expect(matchesCommandQuery("toggle", "Show or Hide Session Minimap", "view.toggleMinimap")).toBe(true);
  });

  it("matches everything for an empty query", () => {
    expect(matchesCommandQuery("  ", "Back", "go.back")).toBe(true);
  });

  it("matches Korean by word and Japanese/Chinese anywhere in the title", () => {
    expect(matchesCommandQuery("설정", "설정 관리자 열기", "go.settingsManager")).toBe(true);
    expect(matchesCommandQuery("マネージャー", "設定マネージャーを開く", "go.settingsManager")).toBe(true);
    expect(matchesCommandQuery("管理器", "打开设置管理器", "go.settingsManager")).toBe(true);
    expect(matchesCommandQuery("归档", "打开设置管理器", "go.settingsManager")).toBe(false);
  });
});
