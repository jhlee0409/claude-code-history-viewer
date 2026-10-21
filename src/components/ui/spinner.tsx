import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/icon/Icon";
import type { IconSize } from "@/components/icon/iconRules";
import { cn } from "@/lib/utils";

/**
 * The one loading glyph (inner-UI plan F2a, G-ST6).
 *
 * Standalone it is a status named with the existing `common.loading` text
 * (or `label`). Inside a control that already says it is busy - a Button
 * with `loading` (aria-busy) - it is `decorative`: hidden from assistive
 * technology, so the control keeps its own name. Under reduced motion the
 * base layer stops the spin; the glyph and the busy state remain.
 */
export interface SpinnerProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Icon size (the app's icon sizes: 14, 16, 24). */
  size?: IconSize;
  /** What is loading, read by assistive technology. Default: `common.loading`. */
  label?: string;
  /** Inside a control that announces its busy state itself: no status, hidden. */
  decorative?: boolean;
}

function Spinner({ size = 16, label, decorative = false, className, ...props }: SpinnerProps) {
  const { t } = useTranslation();
  if (decorative) {
    return (
      <span data-slot="spinner" aria-hidden="true" className={cn("inline-flex shrink-0", className)} {...props}>
        <Icon icon={LoaderCircle} size={size} className="animate-spin" />
      </span>
    );
  }
  return (
    <span data-slot="spinner" role="status" className={cn("inline-flex shrink-0 items-center", className)} {...props}>
      <Icon icon={LoaderCircle} size={size} aria-hidden="true" className="animate-spin" />
      <span className="sr-only">{label ?? t("common.loading")}</span>
    </span>
  );
}

export { Spinner };
