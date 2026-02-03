/**
 * RendererCard - Compound component for consistent renderer UI
 *
 * Provides a standardized card pattern with header, content, and actions.
 * Uses RendererHeader internally for consistent collapsible behavior.
 *
 * @example
 * ```tsx
 * <RendererCard variant="success">
 *   <RendererCard.Header
 *     title="File Created"
 *     icon={<FilePlus />}
 *     rightContent={<Badge>ID: 123</Badge>}
 *   />
 *   <RendererCard.Content>
 *     <p>File content here...</p>
 *   </RendererCard.Content>
 * </RendererCard>
 * ```
 */

import { memo, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout, getVariantStyles } from "./styles";
import type { RendererVariant } from "./types";
import { useExpandableContent } from "./hooks";

/**
 * Card container props
 */
interface CardProps {
  /** Renderer variant for styling */
  variant: RendererVariant;
  /** Child components (Header, Content) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Enable collapsible toggle */
  enableToggle?: boolean;
  /** Default expanded state */
  defaultExpanded?: boolean;
  /** Whether this renderer has an error */
  hasError?: boolean;
}

/**
 * Header props
 */
interface HeaderProps {
  /** Header title */
  title: string;
  /** Header icon */
  icon: ReactNode;
  /** Title CSS classes */
  titleClassName?: string;
  /** Right-side content (badges, metadata) */
  rightContent?: ReactNode;
}

/**
 * Content props
 */
interface ContentProps {
  /** Content to render */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Card context to share state between compound components
 */
interface CardContext {
  variant: RendererVariant;
  isExpanded: boolean;
  toggle: () => void;
  hasError: boolean;
  enableToggle: boolean;
}

// Simple context using module-level variable (compound components pattern)
let cardContext: CardContext | null = null;

/**
 * Main card container
 */
const CardRoot = memo(function CardRoot({
  variant,
  children,
  className,
  enableToggle = true,
  defaultExpanded = false,
  hasError = false,
}: CardProps) {
  const { isExpanded, toggle } = useExpandableContent({ defaultExpanded });
  const styles = getVariantStyles(variant);

  // Set context for child components
  cardContext = {
    variant,
    isExpanded,
    toggle,
    hasError,
    enableToggle,
  };

  return (
    <div
      className={cn(
        "mt-1.5 border border-border overflow-hidden",
        layout.rounded,
        styles.container,
        hasError && "bg-destructive/10 border-destructive/50",
        className
      )}
    >
      {children}
    </div>
  );
});

/**
 * Card header (collapsible or static)
 */
const CardHeader = memo(function CardHeader({
  title,
  icon,
  titleClassName,
  rightContent,
}: HeaderProps) {
  const { t } = useTranslation();
  const context = cardContext;

  if (!context) {
    throw new Error("RendererCard.Header must be used within RendererCard");
  }

  const { isExpanded, toggle, hasError, enableToggle, variant } = context;
  const styles = getVariantStyles(variant);

  // Static header (no toggle)
  if (!enableToggle) {
    return (
      <div
        className={cn(
          "flex items-center justify-between",
          layout.headerPadding,
          layout.headerHeight
        )}
      >
        <div className={cn("flex items-center", layout.iconGap)}>
          {hasError ? (
            <X className={cn(layout.iconSize, "shrink-0 text-destructive")} />
          ) : (
            icon
          )}
          <span
            className={cn(
              layout.titleText,
              titleClassName,
              hasError && "text-destructive"
            )}
          >
            {`${title} ${hasError ? t("common.errorOccurred") : ""}`}
          </span>
        </div>
        <div
          className={cn(
            "flex items-center shrink-0",
            layout.iconGap,
            layout.smallText
          )}
        >
          {rightContent}
        </div>
      </div>
    );
  }

  // Collapsible header (with toggle button)
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "w-full flex items-center justify-between text-left",
        layout.headerPadding,
        layout.headerHeight,
        "hover:bg-muted/50 transition-colors"
      )}
    >
      <div className={cn("flex items-center", layout.iconGap)}>
        <ChevronRight
          className={cn(
            layout.iconSize,
            "shrink-0 transition-transform duration-200 text-muted-foreground",
            isExpanded && "rotate-90"
          )}
        />
        {hasError ? (
          <X className={cn(layout.iconSize, "shrink-0 text-destructive")} />
        ) : (
          icon
        )}
        <span
          className={cn(
            layout.titleText,
            titleClassName || styles.title,
            hasError && "text-destructive"
          )}
        >
          {`${title} ${hasError ? t("common.errorOccurred") : ""}`}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center shrink-0",
          layout.iconGap,
          layout.smallText
        )}
      >
        {rightContent}
      </div>
    </button>
  );
});

/**
 * Card content (visible when expanded)
 */
const CardContent = memo(function CardContent({
  children,
  className,
}: ContentProps) {
  const context = cardContext;

  if (!context) {
    throw new Error("RendererCard.Content must be used within RendererCard");
  }

  const { isExpanded, enableToggle } = context;

  // Always visible if toggle disabled
  if (!enableToggle) {
    return <div className={cn(layout.contentPadding, className)}>{children}</div>;
  }

  // Only visible when expanded
  return isExpanded ? (
    <div className={cn(layout.contentPadding, className)}>{children}</div>
  ) : null;
});

/**
 * Compound component export
 */
export const RendererCard = Object.assign(CardRoot, {
  Header: CardHeader,
  Content: CardContent,
});
