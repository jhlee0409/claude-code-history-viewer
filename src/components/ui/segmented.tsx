import * as React from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import { useRovingFocus } from "./useRovingFocus";

const Selection = React.createContext<{ value: string; onValueChange: (value: string) => void; size: "header" | "toolbar" } | null>(null);

interface SegmentedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Header = 28px, toolbar = 26px; touch targets remain at least 44px. */
  size?: "header" | "toolbar";
}

export function Segmented({ value, onValueChange, size = "header", className, onKeyDown, onFocus, ...props }: SegmentedProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(ref, '[data-segmented-item]', true);
  return (
    <Selection.Provider value={{ value, onValueChange, size }}>
      <div {...props} ref={ref} role="radiogroup" data-size={size} className={cn("segmented", className)}
        onKeyDown={(event) => { onKeyDown?.(event); roving.onKeyDown(event); }}
        onFocus={(event) => { onFocus?.(event); roving.onFocus(event); }} />
    </Selection.Provider>
  );
}

export function SegmentedItem({ value, className, onClick, ...props }: Omit<ButtonProps, "value" | "variant"> & { value: string }) {
  const selection = React.useContext(Selection);
  if (!selection) throw new Error("SegmentedItem must be inside Segmented");
  return <Button {...props} type={props.type ?? "button"} variant="ghost" role="radio" aria-checked={selection.value === value}
    data-segmented-item="" tabIndex={-1} className={cn("segmented-item h-auto px-3 py-1 text-list pointer-coarse:min-h-11", selection.size === "toolbar" ? "min-h-6.5" : "min-h-7", className)}
    onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) selection.onValueChange(value); }} />;
}
