/**
 * Shared styles for renderer components
 *
 * This file provides centralized styling configuration using design tokens.
 * All color values use Tailwind CSS with CSS custom properties for theming.
 *
 * @example
 * // Get styles for a tool variant
 * const styles = getVariantStyles("success");
 * <div className={styles.container}>...</div>
 */

import type { RendererVariant } from "./types";

/**
 * Style configuration for a renderer variant
 */
export interface VariantStyles {
  /** Container background and border */
  container: string;
  /** Icon color */
  icon: string;
  /** Title text color */
  title: string;
  /** Badge/tag background */
  badge: string;
  /** Badge/tag text color */
  badgeText: string;
  /** Accent color for highlights */
  accent: string;
}

/**
 * Variant style definitions using design tokens
 * Industrial Luxury palette with distinct colors for each category
 */
const VARIANT_STYLES: Record<RendererVariant, VariantStyles> = {
  // Status variants
  success: {
    container: "bg-success/10 border-success/30",
    icon: "text-success",
    title: "text-success",
    badge: "bg-success/20",
    badgeText: "text-success",
    accent: "text-success",
  },
  info: {
    container: "bg-info/10 border-info/30",
    icon: "text-info",
    title: "text-info",
    badge: "bg-info/20",
    badgeText: "text-info",
    accent: "text-info",
  },
  warning: {
    container: "bg-warning/10 border-warning/30",
    icon: "text-warning",
    title: "text-warning",
    badge: "bg-warning/20",
    badgeText: "text-warning",
    accent: "text-warning",
  },
  error: {
    container: "bg-destructive/10 border-destructive/30",
    icon: "text-destructive",
    title: "text-destructive",
    badge: "bg-destructive/20",
    badgeText: "text-destructive",
    accent: "text-destructive",
  },
  neutral: {
    container: "bg-muted/50 border-border",
    icon: "text-muted-foreground",
    title: "text-foreground",
    badge: "bg-secondary",
    badgeText: "text-foreground/80",
    accent: "text-foreground",
  },

  // Tool variants (Industrial Palette)
  code: {
    container: "bg-tool-code/10 border-tool-code/30",
    icon: "text-tool-code",
    title: "text-foreground",
    badge: "bg-tool-code/20",
    badgeText: "text-tool-code",
    accent: "text-tool-code",
  },
  file: {
    container: "bg-tool-file/10 border-tool-file/30",
    icon: "text-tool-file",
    title: "text-foreground",
    badge: "bg-tool-file/20",
    badgeText: "text-tool-file",
    accent: "text-tool-file",
  },
  search: {
    container: "bg-tool-search/10 border-tool-search/30",
    icon: "text-tool-search",
    title: "text-foreground",
    badge: "bg-tool-search/20",
    badgeText: "text-tool-search",
    accent: "text-tool-search",
  },
  task: {
    container: "bg-tool-task/10 border-tool-task/30",
    icon: "text-tool-task",
    title: "text-foreground",
    badge: "bg-tool-task/20",
    badgeText: "text-tool-task",
    accent: "text-tool-task",
  },
  system: {
    container: "bg-tool-system/10 border-tool-system/30",
    icon: "text-tool-system",
    title: "text-foreground",
    badge: "bg-tool-system/20",
    badgeText: "text-tool-system",
    accent: "text-tool-system",
  },
  thinking: {
    container: "bg-thinking/50 border-thinking-border",
    icon: "text-thinking-foreground",
    title: "text-thinking-foreground",
    badge: "bg-thinking-muted/30",
    badgeText: "text-thinking-foreground",
    accent: "text-thinking-foreground",
  },

  // New specialized tool variants
  git: {
    container: "bg-tool-git/10 border-tool-git/30",
    icon: "text-tool-git",
    title: "text-foreground",
    badge: "bg-tool-git/20",
    badgeText: "text-tool-git",
    accent: "text-tool-git",
  },
  web: {
    container: "bg-tool-web/10 border-tool-web/30",
    icon: "text-tool-web",
    title: "text-foreground",
    badge: "bg-tool-web/20",
    badgeText: "text-tool-web",
    accent: "text-tool-web",
  },
  mcp: {
    container: "bg-tool-mcp/10 border-tool-mcp/30",
    icon: "text-tool-mcp",
    title: "text-foreground",
    badge: "bg-tool-mcp/20",
    badgeText: "text-tool-mcp",
    accent: "text-tool-mcp",
  },
  document: {
    container: "bg-tool-document/10 border-tool-document/30",
    icon: "text-tool-document",
    title: "text-foreground",
    badge: "bg-tool-document/20",
    badgeText: "text-tool-document",
    accent: "text-tool-document",
  },
  terminal: {
    container: "bg-tool-terminal/10 border-tool-terminal/30",
    icon: "text-tool-terminal",
    title: "text-foreground",
    badge: "bg-tool-terminal/20",
    badgeText: "text-tool-terminal",
    accent: "text-tool-terminal",
  },
};

/**
 * Get styles for a specific variant
 */
export function getVariantStyles(variant: RendererVariant): VariantStyles {
  return VARIANT_STYLES[variant];
}

/**
 * Standardized layout constants for all renderers
 * These ensure visual consistency across all renderer components
 *
 * @example
 * // Using layout constants in a component
 * <div className={cn(layout.headerPadding, layout.headerHeight)}>
 *   <Icon className={layout.iconSize} />
 *   <span className={layout.titleText}>Title</span>
 * </div>
 *
 * Size Reference:
 * - containerPadding: 10px all sides
 * - headerPadding: 10px horizontal, 6px vertical
 * - iconGap: 6px
 * - iconSize: 16x16px (standard)
 * - iconSizeSmall: 12x12px (badges)
 * - titleText/bodyText/smallText: 12px
 * - headerHeight: 32px (fixed)
 * - rounded: 6px border radius
 * - codeMaxHeight: 256px
 * - contentMaxHeight: 384px
 */
export const layout = {
  /** Container padding */
  containerPadding: "p-2.5",
  /** Header padding (for collapsible headers) */
  headerPadding: "px-2.5 py-1.5",
  /** Header fixed height (32px) */
  headerHeight: "h-8",
  /** Content padding (inside expanded content) */
  contentPadding: "px-2.5 pb-2.5",
  /** Gap between icon and text */
  iconGap: "gap-1.5",
  /** Alternative spacing using space-x */
  iconSpacing: "space-x-1.5",
  /** Standard icon size */
  iconSize: "w-4 h-4",
  /** Small icon size (for status indicators) */
  iconSizeSmall: "w-3 h-3",
  /** Title text style */
  titleText: "text-[12px] font-medium",
  /** Body text style */
  bodyText: "text-[12px]",
  /** Small/meta text style */
  smallText: "text-[12px]",
  /** Monospace text */
  monoText: "text-[12px] font-mono",
  /** Standard border radius */
  rounded: "rounded-md",
  /** Code block max height */
  codeMaxHeight: "max-h-64",
  /** Content max height */
  contentMaxHeight: "max-h-96",
  /** Prose/markdown style */
  prose: "prose prose-xs max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/80 prose-a:text-info prose-code:text-accent prose-code:bg-muted prose-pre:bg-muted prose-pre:text-foreground",
} as const;

/**
 * Composite layout classes for common patterns
 */
export const layoutComposite = {
  /** Standard renderer container */
  container: `${layout.rounded} ${layout.containerPadding} border`,
  /** Header row with icon and title */
  headerRow: `flex items-center ${layout.iconSpacing} mb-2`,
  /** Collapsible header button */
  headerButton: `w-full flex items-center justify-between ${layout.headerPadding} text-left hover:bg-muted/50 transition-colors`,
  /** Content area inside renderer */
  contentArea: layout.contentPadding,
  /** Code/pre block */
  codeBlock: `${layout.smallText} ${layout.rounded} p-2 overflow-x-auto whitespace-pre-wrap ${layout.codeMaxHeight} font-mono`,
  /** Badge/tag */
  badge: `${layout.smallText} px-1.5 py-0.5 ${layout.rounded} font-mono`,
} as const;

/**
 * Common component styles
 */
export const commonStyles = {
  /** Code block container */
  codeBlock: "rounded overflow-hidden max-h-96 overflow-y-auto",

  /** Code block header */
  codeBlockHeader:
    "flex justify-between items-center px-3 py-1 bg-secondary border-b border-border text-sm",

  /** Inline code */
  inlineCode: "text-xs px-2 py-1 rounded font-mono",

  /** File path display */
  filePath: "font-mono text-sm",

  /** Section divider */
  divider: "border-t border-border my-3",

  /** Metadata row */
  metaRow: "flex items-center space-x-2 text-xs text-muted-foreground",

  /** Scrollable container */
  scrollable: "max-h-96 overflow-y-auto",

  /** Card-like container */
  card: "p-3 rounded-lg border bg-card border-border",

  /** Muted text */
  muted: "text-muted-foreground",

  /** Small text */
  small: "text-xs",

  /** Icon with text */
  iconText: "flex items-center gap-2",

  /** Badge */
  badge: "px-2 py-0.5 rounded text-xs font-medium",
} as const;

/**
 * Prism theme configuration (shared across all code renderers)
 */
export const codeTheme = {
  fontSize: "0.8125rem",
  lineHeight: "1.25rem",
  padding: "0.5rem",
} as const;
