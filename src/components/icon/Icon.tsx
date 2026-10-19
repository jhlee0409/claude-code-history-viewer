/**
 * The app's icon rules (plan T5, decision D11; decision page §7).
 *
 * | Where                                   | Size | Stroke |
 * |-----------------------------------------|------|--------|
 * | toolbar, sidebar, tabs (default)        | 16   | 1.75   |
 * | small icons inside lists (close, chevron)| 14  | 1.75   |
 * | empty states, guidance, mobile tab bar  | 24   | 1.5    |
 *
 * `IconProvider` (mounted once at the root) gives every lucide icon the
 * 16 / 1.75 default, so an icon sized 14 or 16 by its classes needs nothing
 * else. A 24 px icon goes through `<Icon size={24}>` for its lighter stroke.
 * `src/test/icons.invariant.test.ts` holds both lines.
 */
import type { ReactNode } from "react";
import { LucideProvider, type LucideIcon, type LucideProps } from "lucide-react";
import { DEFAULT_ICON_SIZE, ICON_STROKE, type IconSize } from "./iconRules";

export interface IconProps
  extends Omit<LucideProps, "ref" | "size" | "width" | "height" | "strokeWidth" | "absoluteStrokeWidth"> {
  /** The lucide glyph to draw. */
  icon: LucideIcon;
  size?: IconSize;
}

/** A lucide glyph at one of the decided sizes, with that size's stroke. */
export function Icon({ icon: Glyph, size = DEFAULT_ICON_SIZE, ...props }: IconProps) {
  return <Glyph size={size} strokeWidth={ICON_STROKE[size]} {...props} />;
}

/** The default size and stroke for every lucide icon below it. */
export function IconProvider({ children }: { children: ReactNode }) {
  return (
    <LucideProvider size={DEFAULT_ICON_SIZE} strokeWidth={ICON_STROKE[DEFAULT_ICON_SIZE]}>
      {children}
    </LucideProvider>
  );
}
