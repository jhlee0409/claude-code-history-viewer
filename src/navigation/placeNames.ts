/**
 * Place names: one name per place (plan F4a, D17; audit G-MC2, V-GS1).
 *
 * Every surface that names a place reads its key from here: the sidebar
 * Library rows and rail, the header's view tabs, the content title and tab
 * titles (`VIEW_REGISTRY`), the palette's "Open …" commands and the phone tab
 * bar. A place reached at another scope keeps the same noun with the scope
 * after it ("Analytics" / "Analytics · All projects") instead of a second
 * name ("Global Statistics" vs "Global Overview").
 *
 * A place has its one name on the phone too. A long name ("Claude Code
 * Settings") is the tab bar's layout problem (the label may wrap to two
 * lines), never a reason for a shorter second name.
 */
import type { View } from "./place";

/**
 * Views that have no table name yet, and why. Every view is either here or in
 * `PLACE_NAMES` (`placeNames.invariant.test.tsx`).
 */
export const UNNAMED_VIEWS = {
  empty: "Not a place: the start screen asks the user to pick a session.",
} as const satisfies Partial<Record<View, string>>;

type NamedView = Exclude<View, keyof typeof UNNAMED_VIEWS>;

export const PLACE_NAMES = {
  conversation: "common.place.messages",
  analytics: "common.place.analytics",
  globalStats: "common.place.analyticsAllProjects",
  edits: "common.place.edits",
  /**
   * Parent decision (F4a): the full name everywhere, the phone tab included:
   * "Session board" / "세션 보드" / "セッションボード" / "会话面板" / "會話面板".
   */
  board: "common.place.board",
  archive: "common.place.archive",
  /**
   * Owner decision (2026-10-17): "Claude Code Settings" / "Claude Code 설정"
   * on every surface. Not the app preferences gear ("Settings…").
   */
  settingsManager: "common.place.claudeCodeSettings",
} as const satisfies Record<NamedView, string>;

export type PlaceNameKey = (typeof PLACE_NAMES)[NamedView];

/** The i18n key of a place's one name. */
export const placeNameKey = <V extends NamedView>(view: V): (typeof PLACE_NAMES)[V] => PLACE_NAMES[view];
