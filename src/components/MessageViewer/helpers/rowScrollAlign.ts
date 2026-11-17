/**
 * Where a scroll that brings one transcript row into view places it: centred
 * when the row fits the scroll viewport, at the viewport's top when it is
 * taller. Centring a taller row clips both its head and its tail (on a phone,
 * the trailing actions of an opened tool detail: #779); aligning its start
 * keeps the head in view and leaves the rest to an ordinary scroll down.
 *
 * `viewportHeight` is the scroll viewport's own height: the mobile controls
 * lane is reserved outside it, so nothing is subtracted for it here.
 */
export function rowScrollAlign(rowHeight: number, viewportHeight: number): "center" | "start" {
  return viewportHeight > 0 && rowHeight > viewportHeight ? "start" : "center";
}
