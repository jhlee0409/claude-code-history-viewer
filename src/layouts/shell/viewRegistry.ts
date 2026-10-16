/**
 * VIEW_REGISTRY: the one place that says what each screen is (plan T3, D15).
 *
 * Every `View` of the place model has one entry. The shell reads it for the
 * main-area body (`component` inside its `frame`), the content header
 * (`icon`, `titleKey`, `header.subtitle`), the right-hand inspector, the
 * header's view tabs (`tab`) and the mobile analytics sub-nav. Nothing else in
 * `src/layouts` picks a component, title or icon per view; the registry test
 * holds that line.
 *
 * A screen has one icon (`SCREEN_ICONS`, decision page section 7): the header
 * tab draws the entry's `icon`, so a tab and its content header cannot
 * disagree (the board once showed a message icon in its header and columns on
 * its tab; token stats showed coins and activity).
 */
import type { ComponentType, ReactNode } from "react";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { ClaudeSession } from "@/types";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { ToolbarView, View } from "@/navigation/place";
import { SCREEN_ICONS } from "@/components/icon/screenIcons";
import {
  AnalyticsScreen,
  ArchiveScreen,
  BareFrame,
  BoardScreen,
  ConversationScreen,
  EmptyScreen,
  PaddedFrame,
  RecentEditsScreen,
  ScrollFrame,
  SettingsScreen,
  TokenStatsScreen,
  type ViewScreenProps,
} from "./screens";

/** What a content-header subtitle may draw on. */
export interface HeaderContext {
  t: TFunction;
  selectedSession: ClaudeSession | null;
  /** Global stats' provider-aware description, built by App. */
  globalOverviewDescription: string;
}

export interface ViewEntry {
  /** The main-area body. */
  component: ComponentType<ViewScreenProps>;
  /** What the body sits in inside the view panel. */
  frame: ComponentType<{ children: ReactNode }>;
  /** The screen's mark: header tab, content header, mobile sub-nav. */
  icon: LucideIcon;
  /**
   * The screen's name (content header, mobile sub-nav). An i18n key that
   * must exist in `en`; checked by the registry test rather than by type,
   * as the generated key union does not cover every namespace.
   */
  titleKey: string;
  /** The content header above the body; null for screens without one. */
  header: { subtitle: (context: HeaderContext) => string } | null;
  /** Whether the right-hand inspector (message navigator, edits dock) shows. */
  inspector: boolean;
  /**
   * A related screen the content header links to (desktop; the mobile
   * sub-nav lists them). Token stats has no toolbar tab until it becomes an
   * analytics sub-tab (plan C1, T9b), so analytics links to it.
   */
  related?: { view: View; labelKey: string };
}

/** A header view tab: its label (which may differ from the title). It draws the entry's icon. */
export interface TabEntry {
  labelKey: string;
}

/** Screens with a header view tab must say how it looks. */
export type ViewRegistry = {
  [V in View]: ViewEntry & (V extends ToolbarView ? { tab: TabEntry } : { tab?: never });
};

/** The open session's summary, or a placeholder (project analytics and token stats). */
const sessionSummary = ({ t, selectedSession }: HeaderContext) =>
  selectedSession?.summary || t("session.summaryNotFound");

export const VIEW_REGISTRY: ViewRegistry = {
  empty: {
    component: EmptyScreen,
    frame: BareFrame,
    icon: SCREEN_ICONS.conversation,
    titleKey: "session.select",
    header: null,
    inspector: false,
  },
  conversation: {
    component: ConversationScreen,
    frame: BareFrame,
    icon: SCREEN_ICONS.conversation,
    titleKey: "message.view",
    header: null,
    inspector: true,
    tab: { labelKey: "message.view" },
  },
  analytics: {
    component: AnalyticsScreen,
    frame: ScrollFrame,
    icon: SCREEN_ICONS.analytics,
    titleKey: "analytics.dashboard",
    header: { subtitle: sessionSummary },
    inspector: false,
    tab: { labelKey: "analytics.dashboard" },
    related: { view: "tokenStats", labelKey: "messages.tokenStats.title" },
  },
  tokenStats: {
    component: TokenStatsScreen,
    frame: ScrollFrame,
    icon: SCREEN_ICONS.tokenStats,
    titleKey: "messages.tokenStats.title",
    header: { subtitle: sessionSummary },
    inspector: false,
    related: { view: "analytics", labelKey: "analytics.dashboard" },
  },
  edits: {
    component: RecentEditsScreen,
    frame: ScrollFrame,
    icon: SCREEN_ICONS.edits,
    titleKey: "recentEdits.title",
    header: { subtitle: ({ t }) => t("recentEdits.description") },
    inspector: false,
    tab: { labelKey: "recentEdits.title" },
  },
  board: {
    component: BoardScreen,
    frame: BareFrame,
    icon: SCREEN_ICONS.board,
    titleKey: "session.board.title",
    header: {
      subtitle: ({ t }) =>
        t("session.board.description", "Comparative overview of different sessions"),
    },
    inspector: false,
    tab: { labelKey: "session.board.title" },
  },
  globalStats: {
    component: AnalyticsScreen,
    frame: ScrollFrame,
    icon: SCREEN_ICONS.globalStats,
    titleKey: "analytics.globalOverview",
    header: { subtitle: ({ globalOverviewDescription }) => globalOverviewDescription },
    inspector: false,
  },
  archive: {
    component: ArchiveScreen,
    frame: PaddedFrame,
    icon: SCREEN_ICONS.archive,
    titleKey: "archive.title",
    header: { subtitle: ({ t }) => t("archive.description") },
    inspector: false,
  },
  settingsManager: {
    component: SettingsScreen,
    frame: PaddedFrame,
    icon: SCREEN_ICONS.settings,
    titleKey: "settingsManager.title",
    header: { subtitle: ({ t }) => t("settingsManager.description") },
    inspector: false,
  },
};

/** The toolbar's screen tabs, in display order. */
export const TOOLBAR_TAB_ORDER: readonly ToolbarView[] = [
  "conversation",
  "analytics",
  "edits",
  "board",
];

/** The project screens the mobile layout switches between under its header. */
export type MobileAnalyticsView = "analytics" | "tokenStats" | "edits";

export const MOBILE_ANALYTICS_VIEWS: readonly MobileAnalyticsView[] = [
  "analytics",
  "tokenStats",
  "edits",
];

export const isMobileAnalyticsView = (view: View): view is MobileAnalyticsView =>
  (MOBILE_ANALYTICS_VIEWS as readonly View[]).includes(view);

/** The per-screen flags the analytics hook exposes (its `computed`). */
export type ScreenFlags = Pick<
  UseAnalyticsReturn["computed"],
  | "isMessagesView"
  | "isTokenStatsView"
  | "isAnalyticsView"
  | "isGlobalStatsView"
  | "isRecentEditsView"
  | "isSettingsView"
  | "isBoardView"
  | "isArchiveView"
  | "isEmptyView"
>;

/** Flag → screen, in the precedence the hand-written branches had. */
const SCREEN_FLAGS: ReadonlyArray<readonly [keyof ScreenFlags, View]> = [
  ["isArchiveView", "archive"],
  ["isSettingsView", "settingsManager"],
  ["isBoardView", "board"],
  ["isRecentEditsView", "edits"],
  ["isAnalyticsView", "analytics"],
  ["isGlobalStatsView", "globalStats"],
  ["isTokenStatsView", "tokenStats"],
  ["isEmptyView", "empty"],
];

/**
 * The screen the shell renders, read from the analytics hook's flags.
 *
 * Transitional: the flags are the contract the shell's consumers and tests
 * already drive (`useAnalyticsComputed` sets exactly one), so the registry is
 * keyed off them rather than the store's raw `view`. No flag falls through to
 * the conversation screen, as the last branch of the old chain did.
 */
export function screenOf(flags: Partial<ScreenFlags>): View {
  return SCREEN_FLAGS.find(([flag]) => flags[flag])?.[1] ?? "conversation";
}
