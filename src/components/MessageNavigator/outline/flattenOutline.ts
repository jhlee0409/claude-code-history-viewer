import type { OutlineChildRow, TurnGroup } from "./types";

export type OutlineRow =
  | { type: "turn"; key: string; turn: TurnGroup; isOpen: boolean; posInSet: number; setSize: number }
  | { type: "child"; key: string; turnKey: string; child: OutlineChildRow; posInSet: number; setSize: number };

/**
 * Flattens turns into the visible-rows list for the outline's virtualizer and
 * its roving focus: every turn header, plus the children of open turns only.
 * `posInSet`/`setSize` are 1-based within their level, for
 * aria-posinset/aria-setsize (turns among turns; children within their turn).
 */
export function flattenOutlineRows(turns: TurnGroup[], openKeys: ReadonlySet<string>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const setSize = turns.length;

  turns.forEach((turn, turnIndex) => {
    const isOpen = openKeys.has(turn.key);
    rows.push({
      type: "turn",
      key: turn.key,
      turn,
      isOpen,
      posInSet: turnIndex + 1,
      setSize,
    });

    if (!isOpen) return;

    const childSetSize = turn.children.length;
    turn.children.forEach((child, childIndex) => {
      rows.push({
        type: "child",
        key: child.key,
        turnKey: turn.key,
        child,
        posInSet: childIndex + 1,
        setSize: childSetSize,
      });
    });
  });

  return rows;
}

/**
 * Whether `row` stands for the message `uuid`. A header or message row is
 * keyed by its own uuid; a task or activity row stands for every row it
 * collapsed.
 */
export function rowHoldsUuid(row: OutlineRow, uuid: string): boolean {
  if (row.key === uuid) return true;
  if (row.type !== "child") return false;
  return (
    (row.child.type === "task" || row.child.type === "activity") &&
    row.child.uuids.includes(uuid)
  );
}

/** Finds the key of the turn containing `uuid`, via each turn's own `uuids` list. */
export function findTurnKeyForUuid(turns: TurnGroup[], uuid: string | null): string | null {
  if (uuid === null) return null;
  for (const turn of turns) {
    if (turn.uuids.includes(uuid)) return turn.key;
  }
  return null;
}
