/**
 * What a command acts on: the tab the user saw in front when they issued it
 * (docs/adr/0001-native-menu-input-ownership.md, decision 6 - WYSIWYG).
 *
 * A command can wait in the command queue (`commandQueue.ts`) while input
 * outside the queue - a click on the tab strip, in the sidebar - changes
 * which tab is in front, and a menu event can reach the page after such a
 * click. A command that acts on a tab must act on the tab that was in front
 * when the user issued it, not on whatever is in front when it finally
 * runs. So each command declares its target, the tabs are recorded at issue
 * (`TabsSnapshot`), and it runs only while its target is still there:
 *
 * - `app`: nothing tab-bound (the window, an app-wide setting): it runs.
 * - `tab`: one tab, picked at issue: it acts on that tab, in front or not;
 *   once the tab is closed it does nothing.
 * - `shown`: the tab in front at issue (or one picked from the tab order
 *   then): it does nothing once another tab is in front, or the picked tab
 *   is closed.
 *
 * The target is captured once and never recomputed - not from the commands
 * queued ahead of it either: a New queued before ⌘W leaves ⌘W closing the
 * tab the user saw. Where the issue moment is:
 *
 * - a key, the palette, a control: when the key is pressed / the control
 *   clicked (`issueCommand`, `registry.ts`);
 * - a menu event: when the host recorded it, which stamps it with the tab
 *   the page last reported in front (`menuIssuedTabs`). No stamp: no tab.
 */

/** The tabs as they stand: the one in front, and their order. */
export interface TabsSnapshot {
  activeId: string;
  ids: readonly string[];
}

export type TargetScope = "app" | "tab" | "shown";

export interface CommandTarget {
  scope: TargetScope;
  /** The tab it acts on, from the tabs at issue (default: the one in front). */
  pick?: (tabs: TabsSnapshot) => string | null;
}

export const APP_TARGET: CommandTarget = { scope: "app" };

/**
 * The tab a command issued against `issued` acts on now that the tabs are
 * `live`, or null when its target is gone and it must do nothing. `issued`
 * null: which tab was in front at issue is unknown, so only an `app`
 * command runs. An `app` command gets the tab in front now (it does not use it).
 */
export function targetTab(target: CommandTarget, issued: TabsSnapshot | null, live: TabsSnapshot): string | null {
  if (target.scope === "app") return live.activeId;
  if (issued === null) return null;
  if (target.scope === "shown" && issued.activeId !== live.activeId) return null;
  const id = target.pick ? target.pick(issued) : issued.activeId;
  return id !== null && live.ids.includes(id) ? id : null;
}

/**
 * The tabs a menu event was issued against: the tab the host stamped as in
 * front when the user chose it, in the tab order as the page has it now
 * (the host keeps no order: a ⌘n item picks its position from the order
 * when the page hands the event over). No stamp - an older host, or no page
 * had reported its tabs yet - is null: no tab is the target.
 */
export function menuIssuedTabs(frontTabId: string | null | undefined, live: TabsSnapshot): TabsSnapshot | null {
  return frontTabId ? { activeId: frontTabId, ids: live.ids } : null;
}
