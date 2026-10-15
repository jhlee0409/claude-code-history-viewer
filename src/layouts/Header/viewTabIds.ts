import type { ToolbarView } from "@/navigation/place";

/**
 * DOM ids tying the header's view tabs to the main view they control
 * (`aria-controls` / `aria-labelledby`). The header owns the tabs, the app
 * layout owns the panel; both read the ids from here.
 */
export const VIEW_PANEL_ID = "view-panel";

export const viewTabId = (view: ToolbarView): string => `view-tab-${view}`;
