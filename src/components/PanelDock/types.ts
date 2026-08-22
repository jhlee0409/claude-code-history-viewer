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
  render: () => ReactNode;
}

export interface PanelGroup {
  tabs: PanelId[];
  activeTab: PanelId;
  /** Width in pixels. Per group, so a future split sizes each side. */
  size: number;
}
