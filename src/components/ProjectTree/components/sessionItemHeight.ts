/**
 * Fixed row height of a SessionItem in the virtualized session list, at
 * 100 % font scale. Sized to fit a 2-line wrapped name:
 *   py-2.5 (20px) + name 2 × text-list/leading-relaxed (42px)
 *   + gap-1.5 (6px) + meta text-caption (17px) ≈ 85px → 88px with margin.
 * react-window's FixedSizeList stacks rows at `index * height`, so a row
 * taller than this overlaps the next one (#284); line-clamp-2 caps the name.
 */
export const SESSION_ITEM_HEIGHT = 88;

/**
 * Row height for a font-scale percentage (Settings → font size). The type
 * tokens grow with the scale, so the row must too; below 100 % the 100 %
 * height is kept (rows never shrink under their padding).
 */
export function sessionItemHeight(fontScalePercent: number): number {
  const scale = Number.isFinite(fontScalePercent) ? fontScalePercent / 100 : 1;
  return Math.ceil(SESSION_ITEM_HEIGHT * Math.max(1, scale));
}
