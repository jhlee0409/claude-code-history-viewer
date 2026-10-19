/**
 * One place, one name (plan F4a, D17; audit G-MC2, V-GS1).
 *
 * `PLACE_NAMES` gives every named place one i18n key, and the sidebar, the
 * header tab, the content title, the palette and the phone tab bar all read
 * it. Places that differ in scope get a scoped name ("Analytics" /
 * "Analytics · All projects"), never a second noun ("Global Statistics" vs
 * "Global Overview"). The keys the old second names lived in are retired: a
 * locale file or a call site bringing one back fails here.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { VIEWS } from "@/navigation/place";
import { PLACE_NAMES, UNNAMED_VIEWS, placeNameKey } from "@/navigation/placeNames";
import { VIEW_REGISTRY } from "@/layouts/shell/viewRegistry";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";

const SRC = path.resolve(__dirname, "..");
const LOCALES = ["en", "ko", "ja", "zh-CN", "zh-TW"] as const;

/** Keys that held a second name for a place before the table. */
const RETIRED_NAME_KEYS = [
  "analytics.dashboard",
  "analytics.globalOverview",
  "archive.title",
  "archive.settings.link",
  "common.mobile.tab.analytics",
  "common.mobile.tab.board",
  "common.mobile.tab.messages",
  "common.mobile.tab.settings",
  "project.library.claudeSettings",
  "settingsManager.title",
  "message.view",
  "project.globalStats",
  "project.library.archive",
  "recentEdits.title",
  "session.board.title",
];

function localeStrings(locale: string): Record<string, string> {
  const dir = path.join(SRC, "i18n", "locales", locale);
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : sourceFiles(full);
    return /\.(ts|tsx|json)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && entry.name !== "types.generated.ts"
      ? [full]
      : [];
  });
}

afterEach(() => {
  cleanup();
});

/**
 * The Settings Manager's one name (owner decision, 2026-10-17): the same on
 * every surface, the phone tab included. Phone fit is the tab bar's layout
 * problem, never a reason for a shorter name.
 */
const CLAUDE_CODE_SETTINGS = {
  en: "Claude Code Settings",
  ko: "Claude Code 설정",
  ja: "Claude Code 設定",
  "zh-CN": "Claude Code 设置",
  "zh-TW": "Claude Code 設定",
} as const satisfies Record<(typeof LOCALES)[number], string>;

/**
 * The board's one name (parent decision, F4a): the full name in every locale.
 * "Board" / "ボード" were phone short forms for the one-line tab bar; the bar
 * now takes two-line labels. Messages that name the board use it too.
 */
const SESSION_BOARD = {
  en: "Session board",
  ko: "세션 보드",
  ja: "セッションボード",
  "zh-CN": "会话面板",
  "zh-TW": "會話面板",
} as const satisfies Record<(typeof LOCALES)[number], string>;

/** Messages that name the board. */
const BOARD_MESSAGE_KEYS = ["session.boardNotSupported", "error.loadBoard", "session.board.error.loadBoard"];

describe("place names", () => {
  it("names every view or says why it has no name yet", () => {
    for (const view of VIEWS) {
      const named = view in PLACE_NAMES;
      const unnamed = view in UNNAMED_VIEWS;
      expect(named !== unnamed, view).toBe(true);
    }
  });

  it("exempts only the start screen, which is not a place", () => {
    expect(Object.keys(UNNAMED_VIEWS)).toEqual(["empty"]);
  });

  it.each(LOCALES)("%s: the Settings Manager is called Claude Code Settings", (locale) => {
    const strings = localeStrings(locale);
    expect(strings[placeNameKey("settingsManager")]).toBe(CLAUDE_CODE_SETTINGS[locale]);
    expect(strings["common.command.openSettingsManager"]).toContain(CLAUDE_CODE_SETTINGS[locale]);
  });

  it.each(LOCALES)("%s: the board is called by its full name, in messages too", (locale) => {
    const strings = localeStrings(locale);
    expect(strings[placeNameKey("board")]).toBe(SESSION_BOARD[locale]);
    for (const key of BOARD_MESSAGE_KEYS) {
      // Sentence case: mid-sentence the en name is lower case ("the session board").
      const text = strings[key] ?? "";
      expect(text.toLowerCase(), `${locale} ${key}`).toContain(SESSION_BOARD[locale].toLowerCase());
      expect(text, `${locale} ${key}`).not.toContain("Session Board");
    }
  });

  it.each(LOCALES)("%s: the app preferences gear keeps its own name", (locale) => {
    // `Settings…` (the gear: app preferences) is a different thing.
    const strings = localeStrings(locale);
    for (const key of ["common.command.openPreferences", "common.settings.title"]) {
      expect(strings[key], `${locale} ${key}`).toBeTruthy();
      expect(strings[key], `${locale} ${key}`).not.toContain("Claude Code");
    }
  });

  it.each(LOCALES)("%s: every place name exists and no two places share one", (locale) => {
    const strings = localeStrings(locale);
    const names = Object.values(PLACE_NAMES).map((key) => strings[key]);
    for (const [view, key] of Object.entries(PLACE_NAMES)) {
      expect(strings[key], `${locale} ${view} (${key})`).toBeTruthy();
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(LOCALES)("%s: global stats is the analytics name with its scope", (locale) => {
    const strings = localeStrings(locale);
    const analytics = strings[PLACE_NAMES.analytics] ?? "";
    expect(strings[PLACE_NAMES.globalStats]?.startsWith(`${analytics} · `)).toBe(true);
  });

  it("titles and header tabs read the table", () => {
    for (const [view, key] of Object.entries(PLACE_NAMES)) {
      const entry = VIEW_REGISTRY[view as keyof typeof VIEW_REGISTRY];
      expect(entry.titleKey, view).toBe(key);
      if ("tab" in entry && entry.tab) expect(entry.tab.labelKey, view).toBe(key);
    }
  });

  it.each(LOCALES)("%s: the phone tab bar shows the same names", async (locale) => {
    await i18n.changeLanguage(locale);
    render(<BottomTabBar activeTab="messages" onOpenSidebar={vi.fn()} onSwitchView={vi.fn()} hasProject />);
    for (const view of ["conversation", "board", "analytics", "settingsManager"] as const) {
      const button = screen.getByRole("button", { name: i18n.t(placeNameKey(view)) });
      expect(button.textContent, view).toBe(i18n.t(placeNameKey(view)));
    }
    expect(screen.getByRole("button", { name: CLAUDE_CODE_SETTINGS[locale] })).toBeTruthy();
    await i18n.changeLanguage("en");
  });

  it("the sidebar's Library row and rail use the same name", () => {
    // Both Library renderings read the place key, never a sidebar-only one.
    for (const file of ["components/ProjectTree/components/LibrarySection.tsx", "components/ProjectTree/index.tsx"]) {
      const text = fs.readFileSync(path.join(SRC, file), "utf8");
      expect(text, file).toMatch(/placeNameKey\("settingsManager"\)/);
    }
  });

  it.each(LOCALES)("%s: the palette's archive command names the archive", (locale) => {
    const strings = localeStrings(locale);
    expect(strings["common.command.openArchive"]).toContain(strings[PLACE_NAMES.archive]);
  });

  it("retired second names are gone from every locale and every call site", () => {
    for (const locale of LOCALES) {
      const strings = localeStrings(locale);
      expect(RETIRED_NAME_KEYS.filter((key) => key in strings), locale).toEqual([]);
    }
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const text = fs.readFileSync(file, "utf8");
      return RETIRED_NAME_KEYS.filter((key) => new RegExp(`["'\`]${key.replace(/\./g, "\\.")}["'\`]`).test(text)).map(
        (key) => `${path.relative(SRC, file)}: ${key}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
