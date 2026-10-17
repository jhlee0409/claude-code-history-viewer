/**
 * What a command acts on, captured when it is issued
 * (docs/adr/0001-native-menu-input-ownership.md, decision 6).
 *
 * A command can wait in the command queue (`commandQueue.ts`) while input
 * outside the queue - a click on the tab strip, in the sidebar - changes
 * which tab is in front. A command that acts on a tab must act on the tab
 * that was in front when the user issued it, not on whatever is in front
 * when it finally runs. So each command declares its target, the tabs are
 * recorded when it is issued (`TabsSnapshot`), and it runs only while its
 * target is still there:
 *
 * - `app`: nothing tab-bound (the window, an app-wide setting): it runs.
 * - `tab`: one tab, picked at issue: it acts on that tab, in front or not;
 *   once the tab is closed it does nothing.
 * - `shown`: the tab in front at issue (or one picked from the tab order
 *   then): it does nothing once another tab is in front, or the picked tab
 *   is closed.
 *
 * Commands issued earlier move the target; input outside the queue does not.
 * When a queued command changes the tabs (New, Close, a switch) the commands
 * still waiting behind it take the tabs as it left them (`TargetLedger`):
 * what they would have seen had everything run at once.
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

const sameTabs = (a: TabsSnapshot, b: TabsSnapshot): boolean =>
  a.activeId === b.activeId && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);

/**
 * The tab a command issued against `issued` acts on now that the tabs are
 * `live`, or null when its target is gone and it must do nothing. An `app`
 * command gets the tab in front now (it does not use it).
 */
export function targetTab(target: CommandTarget, issued: TabsSnapshot, live: TabsSnapshot): string | null {
  if (target.scope === "app") return live.activeId;
  if (target.scope === "shown" && issued.activeId !== live.activeId) return null;
  const id = target.pick ? target.pick(issued) : issued.activeId;
  return id !== null && live.ids.includes(id) ? id : null;
}

/** A command's tabs as recorded at its issue, in a ledger's terms. */
export interface IssuedTabs {
  tabs: TabsSnapshot;
  /** How many tab changes by queued commands the ledger had seen then. */
  moves: number;
}

/**
 * The record of tab changes made by the queued commands themselves (one per
 * command queue). It is what lets a command issued earlier move the target
 * of the ones waiting behind it, while a click (outside the queue) cannot.
 */
export interface TargetLedger {
  /** Record the tabs a command is issued against. */
  issue: (now: TabsSnapshot) => IssuedTabs;
  /** The tabs it acts against: as issued, or as the queued commands that ran since left them. */
  tabsFor: (issued: IssuedTabs) => TabsSnapshot;
  /** A queued command ran: if it changed the tabs, the commands still waiting take them as it left them. */
  ran: (before: TabsSnapshot, after: TabsSnapshot) => void;
}

export function createTargetLedger(): TargetLedger {
  let moves = 0;
  let leftBy: TabsSnapshot | null = null;
  return {
    issue: (now) => ({ tabs: now, moves }),
    tabsFor: (issued) => (issued.moves === moves || leftBy === null ? issued.tabs : leftBy),
    ran: (before, after) => {
      if (sameTabs(before, after)) return;
      moves += 1;
      leftBy = after;
    },
  };
}
