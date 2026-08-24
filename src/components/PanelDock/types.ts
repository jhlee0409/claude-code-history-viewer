/**
 * PanelDock types
 *
 * The dock ships holding exactly one group with one tab, and in that state it
 * renders no chrome of its own, so it is visually indistinguishable from a
 * bespoke rail.
 *
 * The array shape is the entire point. A second panel later means a tab strip
 * appears (`tabs.length > 1`); a split later means a second group. Shipping a
 * single hard-coded panel instead would make the second panel a refactor and
 * the third a rewrite.
 */

import type { ReactNode } from "react";

/** Every panel that can be docked. One entry today, by design. */
export type PanelId = "recentEdits";

export interface PanelDefinition {
  id: PanelId;
  /** Shown in the tab strip, and used as the aside's accessible name. */
  title: string;
  /**
   * Shown beside the title when this panel is docked on its own. Supplied by
   * the panel rather than chosen here, so the dock stays generic while each
   * panel still matches the identity it has elsewhere in the app.
   */
  icon?: ReactNode;
  /**
   * Rendered at the far end of the single-panel heading row. For controls that
   * belong to the panel as a whole rather than to its contents, such as the
   * view toggle that sends it back to a full page.
   */
  headerAction?: ReactNode;
  render: () => ReactNode;
}

export interface PanelGroup {
  tabs: PanelId[];
  activeTab: PanelId;
  /** Width in pixels. Per group, so a future split sizes each side. */
  size: number;
}
