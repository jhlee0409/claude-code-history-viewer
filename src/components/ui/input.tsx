import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { fieldControlClasses, useFieldControl } from "./field";

/**
 * Text input (inner-UI plan F2a): the shared field control states
 * (--line-input border, --fg on hover, danger line when invalid, disabled
 * tokens, the base focus ring) and the Field wiring. `variant="error"` is
 * an invalid input (`aria-invalid` unless set). The ghost variant shows its
 * border only on hover.
 */
const inputVariants = cva(
  `flex w-full rounded-md border bg-background px-3 py-2 text-body transition-colors file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground placeholder:text-muted-foreground ${fieldControlClasses}`,
  {
    variants: {
      variant: {
        default: "",
        error: "border-status-danger-line",
        ghost: "border-transparent bg-transparent hover:border-line-input disabled:border-transparent disabled:bg-transparent",
      },
      inputSize: {
        default: "h-10",
        sm: "h-8 text-list px-2",
        lg: "h-12 text-title px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "default",
    },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, inputSize, ...props }, ref) => {
    const field = useFieldControl(props);
    const invalid = field["aria-invalid"] ?? props["aria-invalid"] ?? (variant === "error" ? true : undefined);
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, inputSize }), className)}
        ref={ref}
        {...props}
        {...field}
        aria-invalid={invalid}
      />
    );
  }
);
Input.displayName = "Input";

export { Input, inputVariants };
