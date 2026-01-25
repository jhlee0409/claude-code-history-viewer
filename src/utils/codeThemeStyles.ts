/**
 * Code Theme Styles Utility
 *
 * Provides consistent theme styles for prism-react-renderer Highlight components.
 * Ensures proper light/dark mode colors that won't be overridden by CSS.
 */

import { themes } from "prism-react-renderer";

/**
 * Light mode color palette (VS Light theme)
 */
const LIGHT_COLORS = {
  background: "#ffffff",
  text: "#000000",
  lineNumber: "#237893",
} as const;

/**
 * Dark mode color palette (VS Dark theme)
 */
const DARK_COLORS = {
  background: "#1e1e1e",
  text: "#d4d4d4",
  lineNumber: "#858585",
} as const;

/**
 * Check if dark mode is active by examining the DOM.
 * This is more reliable than relying on React state during hydration.
 */
export function isDarkModeActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/**
 * Get the appropriate prism-react-renderer theme based on dark mode state.
 */
export function getCodeTheme(isDarkMode?: boolean) {
  const isDark = isDarkMode ?? isDarkModeActive();
  return isDark ? themes.vsDark : themes.vsLight;
}

/**
 * Get explicit style overrides to prevent CSS from overriding theme colors.
 * These styles should be spread into the <pre> element's style prop.
 */
export function getCodePreStyles(isDarkMode?: boolean): React.CSSProperties {
  const isDark = isDarkMode ?? isDarkModeActive();
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  return {
    backgroundColor: colors.background,
    color: colors.text,
  };
}

/**
 * Get line number styles with proper theme-aware colors.
 */
export function getLineNumberStyles(isDarkMode?: boolean): React.CSSProperties {
  const isDark = isDarkMode ?? isDarkModeActive();
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  return {
    display: "table-cell",
    textAlign: "right",
    paddingRight: "1em",
    userSelect: "none",
    opacity: 0.7,
    width: "3em",
    color: colors.lineNumber,
  };
}

/**
 * Combined helper that returns all theme-related values for code highlighting.
 */
export function useCodeThemeStyles(isDarkMode?: boolean) {
  const isDark = isDarkMode ?? isDarkModeActive();
  return {
    theme: getCodeTheme(isDark),
    preStyles: getCodePreStyles(isDark),
    lineNumberStyles: getLineNumberStyles(isDark),
    colors: isDark ? DARK_COLORS : LIGHT_COLORS,
  };
}
