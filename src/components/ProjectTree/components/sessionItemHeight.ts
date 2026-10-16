/**
 * Fixed row height of a SessionItem in the virtualized session list.
 * react-window's FixedSizeList stacks rows at `index * height`, so a row
 * taller than this overlaps the next one (#284). The height is derived from
 * the row's layout and its type tokens (index.css), so it follows the font
 * scale (Settings → font size) instead of a hand-tuned constant.
 *
 * Worst-case row (SessionItem.tsx, SessionNameEditor.tsx, SessionMeta.tsx):
 *   py-2.5                                    20px (rem: not font-scaled)
 *   name: 2 lines (line-clamp-2) of text-list × leading-relaxed
 *   gap-1.5                                    6px
 *   meta: a text-caption badge with py-0.5 (storage type / client)
 * The safety margin covers what the formula leaves out: the inline CLI name
 * badge and sub-pixel line rounding add up to 2.2px in WebKit; 4px keeps
 * ~3px headroom at 90-130 % (scripts/ui-capture/test/sessionRowFit.test.mjs
 * measures the real row in every app language).
 */
export const SESSION_ROW = {
  paddingY: 2 * 10,
  gap: 6,
  name: { lines: 2, tokenPx: 13, lineHeight: 1.625 },
  meta: { tokenPx: 12, lineHeight: 1.4, badgePaddingY: 2 * 2 },
  safety: 4,
} as const;

/** Content height of the worst-case row at a font scale (1 = 100 %), unrounded. */
export function sessionItemContentHeight(scale: number): number {
  const { paddingY, gap, name, meta } = SESSION_ROW;
  const nameHeight = name.lines * name.tokenPx * name.lineHeight * scale;
  const metaHeight = meta.tokenPx * meta.lineHeight * scale + meta.badgePaddingY;
  return paddingY + nameHeight + gap + metaHeight;
}

/** Row height (px) for a font-scale percentage. */
export function sessionItemHeight(fontScalePercent: number): number {
  const scale = Number.isFinite(fontScalePercent) ? fontScalePercent / 100 : 1;
  return Math.ceil(sessionItemContentHeight(scale) + SESSION_ROW.safety);
}

/**
 * Row height (px) of the sidebar's one-line session row (`SessionItem`
 * `variant="compact"`, `h-7`). Rem-sized, so it does not follow the font
 * scale: one line of text-list (13px × 1.4) fits it up to 150 %.
 */
export const COMPACT_SESSION_ROW_HEIGHT = 28;
