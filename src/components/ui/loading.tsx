/**
 * Unified Loading Components
 *
 * A comprehensive set of loading UI components for consistent UX across the app.
 * Includes spinners, overlays, progress indicators, and state wrappers.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Inbox, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "@/components/icon/Icon";
import type { IconSize } from "@/components/icon/iconRules";
import { Skeleton, SkeletonText } from "./skeleton";
import i18n from "@/i18n";

// ============================================
// LOADING SPINNER
// ============================================

type SpinnerSize = "xs" | "sm" | "md" | "lg" | "xl";
type SpinnerVariant = "default" | "accent" | "muted" | "primary";

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant */
  size?: SpinnerSize;
  /** Color variant */
  variant?: SpinnerVariant;
  /** Show decorative sparkle overlay */
  withSparkle?: boolean;
  /** Custom icon to use instead of LoaderCircle */
  icon?: LucideIcon;
}

/**
 * Spinner and sparkle sizes. Icons come in 14 / 16 / 24 only, so md, lg and
 * xl share the 24 px spinner (the variants stay for their callers).
 */
const spinnerSizes: Record<SpinnerSize, { spinner: IconSize; sparkle: IconSize; box: string }> = {
  xs: { spinner: 14, sparkle: 14, box: "w-3.5 h-3.5" },
  sm: { spinner: 16, sparkle: 14, box: "w-4 h-4" },
  md: { spinner: 24, sparkle: 14, box: "w-6 h-6" },
  lg: { spinner: 24, sparkle: 14, box: "w-6 h-6" },
  xl: { spinner: 24, sparkle: 16, box: "w-6 h-6" },
};

// `as const`: the icon guard resolves these literal classes (no sizes in them).
const spinnerVariants = {
  default: "text-foreground",
  accent: "text-accent",
  muted: "text-muted-foreground",
  primary: "text-primary",
} as const satisfies Record<SpinnerVariant, string>;

const LoadingSpinner = React.forwardRef<HTMLDivElement, LoadingSpinnerProps>(
  (
    {
      className,
      size = "md",
      variant = "accent",
      withSparkle = false,
      icon: glyph = LoaderCircle,
      ...props
    },
    ref
  ) => {
    const sizeConfig = spinnerSizes[size];
    const colorClass = spinnerVariants[variant];

    if (withSparkle) {
      return (
        <div
          ref={ref}
          className={cn("relative inline-flex items-center justify-center", sizeConfig.box, className)}
          {...props}
        >
          <Icon
            icon={glyph}
            size={sizeConfig.spinner}
            className={cn("absolute", colorClass, "animate-spin opacity-40")}
          />
          <Icon
            icon={Sparkles}
            size={sizeConfig.sparkle}
            className={cn("absolute", colorClass, "animate-pulse")}
          />
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("inline-flex items-center justify-center", className)} {...props}>
        <Icon icon={glyph} size={sizeConfig.spinner} className={cn(colorClass, "animate-spin")} />
      </div>
    );
  }
);
LoadingSpinner.displayName = "LoadingSpinner";

// ============================================
// LOADING PROGRESS
// ============================================

interface LoadingProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Progress value (0-100) */
  progress: number;
  /** Show percentage label */
  showLabel?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Color variant */
  variant?: "default" | "accent" | "success" | "warning";
  /** Indeterminate mode (animated, no progress value) */
  indeterminate?: boolean;
}

const progressSizes: Record<string, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

const progressVariants: Record<string, string> = {
  default: "bg-primary",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
};

const LoadingProgress = React.forwardRef<HTMLDivElement, LoadingProgressProps>(
  (
    {
      className,
      progress,
      showLabel = false,
      size = "md",
      variant = "default",
      indeterminate = false,
      ...props
    },
    ref
  ) => {
    const clampedProgress = Math.min(100, Math.max(0, progress));
    // format-guard: not-a-share — progress bar label, how far a task has got (0-100)
    const label = `${Math.round(clampedProgress)}%`;

    return (
      <div ref={ref} className={cn("w-full", className)} {...props}>
        {showLabel && !indeterminate && (
          <div className="flex justify-end mb-1">
            <span className="text-list text-muted-foreground tabular-nums">
              {label}
            </span>
          </div>
        )}
        <div
          className={cn(
            "w-full bg-muted rounded-full overflow-hidden",
            progressSizes[size]
          )}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300 ease-out",
              progressVariants[variant],
              indeterminate && "animate-shimmer bg-gradient-to-r from-transparent via-current to-transparent"
            )}
            style={{
              width: indeterminate ? "100%" : `${clampedProgress}%`,
            }}
          />
        </div>
      </div>
    );
  }
);
LoadingProgress.displayName = "LoadingProgress";

// ============================================
// LOADING OVERLAY
// ============================================

interface LoadingOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Loading state */
  isLoading: boolean;
  /** Overlay opacity */
  opacity?: "light" | "medium" | "heavy";
  /** Spinner size */
  spinnerSize?: SpinnerSize;
  /** Use sparkle variant */
  withSparkle?: boolean;
  /** Loading message */
  message?: string;
  /** Sub message */
  subMessage?: string;
  /** Show blur effect */
  blur?: boolean;
}

const overlayOpacity: Record<string, string> = {
  light: "bg-background/60",
  medium: "bg-background/80",
  heavy: "bg-background/95",
};

const LoadingOverlay = React.forwardRef<HTMLDivElement, LoadingOverlayProps>(
  (
    {
      className,
      children,
      isLoading,
      opacity = "medium",
      spinnerSize = "lg",
      withSparkle = true,
      message,
      subMessage,
      blur = true,
      ...props
    },
    ref
  ) => {
    return (
      <div ref={ref} className={cn("relative", className)} {...props}>
        {children}
        {isLoading && (
          <div
            className={cn(
              "absolute inset-0 z-50 flex items-center justify-center transition-all duration-300",
              overlayOpacity[opacity],
              blur && "backdrop-blur-sm"
            )}
          >
            <div className="text-center space-y-3">
              <LoadingSpinner
                size={spinnerSize}
                variant="accent"
                withSparkle={withSparkle}
              />
              {message && (
                <div>
                  <p className="text-body font-semibold text-foreground">{message}</p>
                  {subMessage && (
                    <p className="text-list text-muted-foreground mt-0.5">
                      {subMessage}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
LoadingOverlay.displayName = "LoadingOverlay";

// ============================================
// LOADING STATE WRAPPER
// ============================================

interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current loading state */
  isLoading: boolean;
  /** Error state */
  error?: string | null;
  /** What failed, shown above the error's detail */
  errorTitle?: string;
  /** Offered under the error as a retry button */
  onRetry?: () => void;
  /** The retry button's label (required with `onRetry`) */
  retryLabel?: string;
  /** Empty state check */
  isEmpty?: boolean;
  /** Custom loading component */
  loadingComponent?: React.ReactNode;
  /** Custom error component */
  errorComponent?: React.ReactNode;
  /** Custom empty component */
  emptyComponent?: React.ReactNode;
  /** Loading message */
  loadingMessage?: string;
  /** Loading sub message */
  loadingSubMessage?: string;
  /** Spinner size */
  spinnerSize?: SpinnerSize;
  /** Use sparkle variant */
  withSparkle?: boolean;
  /** Use skeleton instead of spinner */
  useSkeleton?: boolean;
  /** Number of skeleton lines */
  skeletonLines?: number;
  /** Minimum height for loading/empty states */
  minHeight?: string;
}

const LoadingState = React.forwardRef<HTMLDivElement, LoadingStateProps>(
  (
    {
      className,
      children,
      isLoading,
      error,
      errorTitle,
      onRetry,
      retryLabel,
      isEmpty = false,
      loadingComponent,
      errorComponent,
      emptyComponent,
      loadingMessage,
      loadingSubMessage,
      spinnerSize = "lg",
      withSparkle = true,
      useSkeleton = false,
      skeletonLines = 3,
      minHeight = "py-12",
      ...props
    },
    ref
  ) => {
    // Loading state
    if (isLoading) {
      if (loadingComponent) {
        return (
          <div ref={ref} className={className} {...props}>
            {loadingComponent}
          </div>
        );
      }

      if (useSkeleton) {
        return (
          <div
            ref={ref}
            className={cn("space-y-4 p-4", className)}
            {...props}
          >
            <div className="flex items-center gap-4">
              <Skeleton variant="circular" className="w-10 h-10" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
            <SkeletonText lines={skeletonLines} />
          </div>
        );
      }

      return (
        <div
          ref={ref}
          className={cn(
            "flex flex-col items-center justify-center",
            minHeight,
            className
          )}
          {...props}
        >
          <div className="text-center space-y-4">
            <LoadingSpinner
              size={spinnerSize}
              variant="accent"
              withSparkle={withSparkle}
            />
            {loadingMessage && (
              <div>
                <p className="text-body font-semibold text-foreground">
                  {loadingMessage}
                </p>
                {loadingSubMessage && (
                  <p className="text-list text-muted-foreground mt-1">
                    {loadingSubMessage}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Error state
    if (error) {
      if (errorComponent) {
        return (
          <div ref={ref} className={className} {...props}>
            {errorComponent}
          </div>
        );
      }

      return (
        <div
          ref={ref}
          className={cn(
            "flex flex-col items-center justify-center",
            minHeight,
            className
          )}
          {...props}
        >
          <div className="text-center max-w-sm" role="alert">
            <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
<Icon icon={TriangleAlert} size={24} className="text-destructive" />
            </div>
            {errorTitle && (
              <p className="text-body font-semibold text-foreground mb-1">
                {errorTitle}
              </p>
            )}
            <p className="text-body text-destructive break-words">{error}</p>
            {onRetry && retryLabel && (
              <button
                type="button"
                onClick={onRetry}
                className="action-btn primary mt-4"
              >
                {retryLabel}
              </button>
            )}
          </div>
        </div>
      );
    }

    // Empty state
    if (isEmpty) {
      if (emptyComponent) {
        return (
          <div ref={ref} className={className} {...props}>
            {emptyComponent}
          </div>
        );
      }

      return (
        <div
          ref={ref}
          className={cn(
            "flex flex-col items-center justify-center",
            minHeight,
            className
          )}
          {...props}
        >
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
<Icon icon={Inbox} size={24} className="text-muted-foreground/50" />
            </div>
            <p className="text-body text-muted-foreground">{i18n.t("common.noDataAvailable")}</p>
          </div>
        </div>
      );
    }

    // Normal content
    return (
      <div ref={ref} className={className} {...props}>
        {children}
      </div>
    );
  }
);
LoadingState.displayName = "LoadingState";

// ============================================
// LOADING DOTS (Alternative spinner style)
// ============================================

interface LoadingDotsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Color variant */
  variant?: SpinnerVariant;
}

const dotSizes: Record<string, string> = {
  sm: "w-1 h-1",
  md: "w-1.5 h-1.5",
  lg: "w-2 h-2",
};

const dotGaps: Record<string, string> = {
  sm: "gap-0.5",
  md: "gap-1",
  lg: "gap-1.5",
};

const LoadingDots = React.forwardRef<HTMLDivElement, LoadingDotsProps>(
  ({ className, size = "md", variant = "accent", ...props }, ref) => {
    const colorClass = spinnerVariants[variant];

    return (
      <div
        ref={ref}
        className={cn("flex items-center", dotGaps[size], className)}
        {...props}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "rounded-full animate-pulse",
              dotSizes[size],
              colorClass.replace("text-", "bg-")
            )}
            style={{
              animationDelay: `${i * 150}ms`,
              animationDuration: "1s",
            }}
          />
        ))}
      </div>
    );
  }
);
LoadingDots.displayName = "LoadingDots";

// ============================================
// LOADING BUTTON CONTENT
// ============================================

interface LoadingButtonContentProps {
  /** Loading state */
  isLoading: boolean;
  /** Default content */
  children: React.ReactNode;
  /** Loading text (optional, shows spinner only if not provided) */
  loadingText?: string;
  /** Spinner size */
  spinnerSize?: SpinnerSize;
}

const LoadingButtonContent: React.FC<LoadingButtonContentProps> = ({
  isLoading,
  children,
  loadingText,
  spinnerSize = "sm",
}) => {
  if (isLoading) {
    return (
      <span className="flex items-center gap-2">
        <LoadingSpinner size={spinnerSize} variant="default" />
        {loadingText && <span>{loadingText}</span>}
      </span>
    );
  }

  return <>{children}</>;
};
LoadingButtonContent.displayName = "LoadingButtonContent";

export {
  LoadingSpinner,
  LoadingProgress,
  LoadingOverlay,
  LoadingState,
  LoadingDots,
  LoadingButtonContent,
  type LoadingSpinnerProps,
  type LoadingProgressProps,
  type LoadingOverlayProps,
  type LoadingStateProps,
  type LoadingDotsProps,
  type LoadingButtonContentProps,
  type SpinnerSize,
  type SpinnerVariant,
};
