import type { OutlineRow } from "./flattenOutline";

export interface VirtualItemLike {
  /** The row's own index into the flattened rows list the virtualizer renders, not its position within `items` (overscan can make `items` start mid-list). */
  index: number;
  start: number;
  size: number;
}

/**
 * The true first visible row, following the `MessageViewer.tsx:612-618`
 * form (`row.start + row.size > scrollTop`), not `items[0]` (which can
 * include overscan, unlike this). Returns the item's own `index` field.
 */
export function findFirstVisibleIndex(
  items: ReadonlyArray<VirtualItemLike>,
  scrollTop: number,
): number | null {
  const found = items.find((item) => item.start + item.size > scrollTop);
  return found ? found.index : null;
}

/**
 * The key of the turn to show in the pinned-header overlay: the open turn
 * whose child is the first visible row. Null when the first visible row is
 * already a turn header (no overlay needed) or when nothing is visible.
 */
export function findPinnedTurnKey(
  rows: OutlineRow[],
  items: ReadonlyArray<VirtualItemLike>,
  scrollTop: number,
): string | null {
  const index = findFirstVisibleIndex(items, scrollTop);
  if (index === null) return null;
  const row = rows[index];
  if (!row) return null;
  return row.type === "child" ? row.turnKey : null;
}
