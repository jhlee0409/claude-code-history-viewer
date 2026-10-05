import type { OutlineRow } from "./flattenOutline";

/**
 * Where the roving focus index belongs after the outline's rows change
 * (a turn opened or closed, or "Close all turns"). The focused row keeps
 * focus at its new index; a child that disappeared hands focus to its
 * parent header; otherwise the index is clamped.
 */
export function resolveFocusAfterRowsChange(
  previousRows: readonly OutlineRow[],
  rows: readonly OutlineRow[],
  previousIndex: number,
): number {
  if (rows.length === 0) return 0;
  const focused = previousRows[previousIndex];
  if (focused) {
    const sameRow = rows.findIndex((row) => row.key === focused.key);
    if (sameRow >= 0) return sameRow;
    if (focused.type === "child") {
      const parent = rows.findIndex((row) => row.type === "turn" && row.key === focused.turnKey);
      if (parent >= 0) return parent;
    }
  }
  return Math.max(0, Math.min(previousIndex, rows.length - 1));
}

/**
 * The virtualizer's rendered indexes plus `index`, so the row holding the
 * roving `tabIndex=0` stays in the DOM after it scrolls out of view.
 * Without it, Tab would skip the whole tree.
 */
export function includeIndex(indexes: number[], index: number, count: number): number[] {
  if (index < 0 || index >= count || indexes.includes(index)) return indexes;
  return [...indexes, index].sort((a, b) => a - b);
}
