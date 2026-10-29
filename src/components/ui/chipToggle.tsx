import * as React from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import { useRovingFocus } from "./useRovingFocus";

/** Independent toggles: arrows move focus; only activation changes pressed. */
export function ChipToggleGroup({ className, onKeyDown, onFocus, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(ref, 'button', false);
  return <div {...props} ref={ref} role="toolbar" className={cn("flex flex-wrap items-center gap-1", className)}
    onKeyDown={(event) => { onKeyDown?.(event); roving.onKeyDown(event); }}
    onFocus={(event) => { onFocus?.(event); roving.onFocus(event); }} />;
}

export function ChipToggle({ pressed, onPressedChange, className, onClick, ...props }: Omit<ButtonProps, "variant"> & { pressed: boolean; onPressedChange: (pressed: boolean) => void }) {
  return <Button {...props} type={props.type ?? "button"} variant="outline" data-chip-toggle="" aria-pressed={pressed}
    className={cn("h-auto min-h-6.5 pointer-coarse:min-h-11 px-2 py-0 text-list aria-pressed:border-line-selected aria-pressed:bg-surface-selected forced-colors:aria-pressed:border-[Highlight]", className)}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) onPressedChange(!pressed); }} />;
}
