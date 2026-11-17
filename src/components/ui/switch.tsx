import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Switch state contract (inner-UI plan F2a, G-ST7, G-FC3, D10).
 *
 * - Off: an outlined track (--line-input, ≥ 3:1) with an --fg-2 thumb; on:
 *   a --primary track with a --primary-foreground thumb. The thumb travels
 *   16px (≥ 8px).
 * - Hover: the off track's border turns --fg, the on track steps its fill
 *   (`/85`); pressed: one more step (off: a 14% --fg layer in the track, on:
 *   `/70`). Nothing casts a shadow; focus is the base ring.
 * - Disabled: the disabled tokens (--line-faint border and an --fg-disabled
 *   thumb off; an --fg-disabled track on), never faded, so it is told apart
 *   from an enabled switch.
 * - Forced colours: CanvasText track border and thumb; on, a Highlight track
 *   with a HighlightText thumb (the system pair for Highlight; the base
 *   layer adds its Highlight border); disabled in GrayText. Important, so no
 *   hover or pressed fill replaces them.
 * Steps and contrast per theme: src/test/primitiveStates.contrast.test.tsx;
 * computed in real browsers: scripts/ui-capture/test/primitives.states.test.mjs.
 */
const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors",
      "border-line-input bg-transparent enabled:hover:border-fg enabled:active:bg-foreground/14",
      "data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
      "data-[state=checked]:enabled:hover:bg-primary/85 data-[state=checked]:enabled:active:bg-primary/70",
      "data-disabled:cursor-not-allowed data-disabled:border-line-faint",
      "data-disabled:data-[state=checked]:border-transparent data-disabled:data-[state=checked]:bg-fg-disabled",
      "forced-colors:border-[CanvasText] forced-colors:data-[state=checked]:bg-[Highlight]!",
      "forced-colors:data-disabled:border-[GrayText] forced-colors:data-disabled:data-[state=checked]:bg-[GrayText]!",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block size-4 rounded-full transition-transform",
        "bg-fg-2 data-[state=checked]:bg-primary-foreground",
        "data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-4",
        "data-disabled:bg-fg-disabled data-disabled:data-[state=checked]:bg-background",
        "forced-colors:bg-[CanvasText]! forced-colors:data-[state=checked]:bg-[HighlightText]!",
        "forced-colors:data-disabled:bg-[GrayText]! forced-colors:data-disabled:data-[state=checked]:bg-[Canvas]!"
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
