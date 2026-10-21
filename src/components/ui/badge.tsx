import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badge (inner-UI plan F2a, G-ST6 · plan-review-3): a pill label, no shadow.
 *
 * - neutral: a quiet count or tag (--secondary);
 * - muted: secondary information (--muted, --fg-2);
 * - danger / warning / info: the status tokens (surface, fg, line);
 * - outline: a --line-input border only.
 * There is no success badge: success is said with text or a Notice.
 * Older names keep rendering until F2b renames their call sites:
 * default and secondary → neutral, destructive → danger, success and
 * accent → neutral.
 */
const NEUTRAL = "border-transparent bg-secondary text-secondary-foreground";
const DANGER = "border-status-danger-line bg-status-danger-surface text-status-danger-fg";

const badgeVariants = cva(
  "inline-flex items-center rounded-pill border font-medium",
  {
    variants: {
      variant: {
        neutral: NEUTRAL,
        muted: "border-transparent bg-muted text-fg-2",
        danger: DANGER,
        warning: "border-status-warning-line bg-status-warning-surface text-status-warning-fg",
        info: "border-status-info-line bg-status-info-surface text-status-info-fg",
        outline: "border-line-input bg-transparent text-foreground",
        /** @deprecated Older name for `neutral` (F2b renames the call sites). */
        default: NEUTRAL,
        /** @deprecated Older name for `neutral`. */
        secondary: NEUTRAL,
        /** @deprecated Older name for `danger`. */
        destructive: DANGER,
        /** @deprecated No success badge: renders `neutral`. */
        success: NEUTRAL,
        /** @deprecated Renders `neutral`. */
        accent: NEUTRAL,
      },
      size: {
        default: "px-2.5 py-0.5 text-list",
        sm: "px-2 py-0.5 text-caption",
        lg: "px-3 py-1 text-body",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
