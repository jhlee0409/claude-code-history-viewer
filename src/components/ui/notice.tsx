import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Notice: an inline message on the status tokens (inner-UI plan F2a,
 * G-SR6). It is read in place; only `live` makes it an alert (role="alert"),
 * for a message that appears because of what the user just did - a static
 * notice is not announced on every visit. The tone has an icon as well as a
 * colour (hidden from assistive technology; the text says it); `icon={null}`
 * drops it, another lucide glyph replaces it.
 */
const noticeVariants = cva("flex w-full items-start gap-2 rounded-md border px-3 py-2 text-body", {
  variants: {
    variant: {
      neutral: "border-line-faint bg-surface-well text-foreground",
      info: "border-status-info-line bg-status-info-surface text-foreground [&>[data-slot=notice-icon]]:text-status-info-fg",
      warning: "border-status-warning-line bg-status-warning-surface text-foreground [&>[data-slot=notice-icon]]:text-status-warning-fg",
      danger: "border-status-danger-line bg-status-danger-surface text-foreground [&>[data-slot=notice-icon]]:text-status-danger-fg",
      success: "border-status-success-line bg-status-success-surface text-foreground [&>[data-slot=notice-icon]]:text-status-success-fg",
    },
  },
  defaultVariants: { variant: "neutral" },
});

const ICONS: Record<NonNullable<VariantProps<typeof noticeVariants>["variant"]>, LucideIcon> = {
  neutral: Info,
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CircleCheck,
};

export interface NoticeProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "role">,
    VariantProps<typeof noticeVariants> {
  /** A short first line in medium weight. */
  title?: React.ReactNode;
  /** Announce it (role="alert"): only for a message the user's action just caused. */
  live?: boolean;
  /** Another glyph, or `null` for none. Default: the tone's icon. */
  icon?: LucideIcon | null;
}

const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(
  ({ className, variant, title, live = false, icon, children, ...props }, ref) => {
    const Glyph = icon === undefined ? ICONS[variant ?? "neutral"] : icon;
    return (
      <div
        ref={ref}
        data-slot="notice"
        role={live ? "alert" : undefined}
        className={cn(noticeVariants({ variant }), className)}
        {...props}
      >
        {Glyph ? (
          // One text line tall, so the icon sits on the first line at any font scale.
          <span data-slot="notice-icon" className="flex h-[1lh] shrink-0 items-center">
            <Glyph aria-hidden="true" className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium">{title}</p> : null}
          {children ? <div className={cn(title ? "text-fg-2" : undefined)}>{children}</div> : null}
        </div>
      </div>
    );
  }
);
Notice.displayName = "Notice";

export { Notice, noticeVariants };
