/** The decided icon sizes and their strokes (plan T5, decision D11). See `Icon.tsx`. */
export const ICON_SIZES = [14, 16, 24] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/** Stroke width per size, in the 24-unit viewBox lucide draws in. */
export const ICON_STROKE: Readonly<Record<IconSize, number>> = { 14: 1.75, 16: 1.75, 24: 1.5 };

export const DEFAULT_ICON_SIZE: IconSize = 16;
