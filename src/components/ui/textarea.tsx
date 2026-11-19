import * as React from "react";

import { cn } from "@/lib/utils";
import { fieldControlClasses, useFieldControl } from "./field";

/** Multi-line text input with the shared field control states and Field wiring (inner-UI plan F2a). */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  const field = useFieldControl(props);
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md",
        "border bg-background px-3 py-2",
        "text-body transition-colors",
        "placeholder:text-muted-foreground",
        fieldControlClasses,
        "resize-none",
        className
      )}
      ref={ref}
      {...props}
      {...field}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
