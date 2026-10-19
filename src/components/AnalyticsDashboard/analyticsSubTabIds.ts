import type { AnalyticsTab } from "@/navigation/place";

/** DOM ids of the analytics sub-tabs (`AnalyticsSubTabs`) and the panel they control. */
export const analyticsSubTabId = (tab: AnalyticsTab) => `analytics-subtab-${tab}`;
export const ANALYTICS_SUBTAB_PANEL_ID = "analytics-subtab-panel";
