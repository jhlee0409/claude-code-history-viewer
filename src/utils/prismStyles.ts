/**
 * Prism React Renderer Style Utilities
 *
 * Provides consistent styling for code highlighting across all components.
 * Overrides prism theme token styles to prevent unwanted backgrounds, borders, etc.
 */

import type { CSSProperties } from "react";

/**
 * Get styles for the <pre> element
 */
export const getPreStyles = (
  isDarkMode: boolean,
  baseStyle: CSSProperties,
  overrides: CSSProperties = {}
): CSSProperties => ({
  ...baseStyle,
  backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
  color: isDarkMode ? '#d4d4d4' : '#000000',
  margin: 0,
  ...overrides,
});

/**
 * Get styles for line wrapper <div> elements
 */
export const getLineStyles = (
  baseStyle: CSSProperties = {},
  overrides: CSSProperties = {}
): CSSProperties => ({
  ...baseStyle,
  border: 'none',
  borderRadius: 0,
  ...overrides,
});

/**
 * Get styles for individual token <span> elements
 */
export const getTokenStyles = (
  isDarkMode: boolean,
  baseStyle: CSSProperties = {}
): CSSProperties => ({
  ...baseStyle,
  color: baseStyle.color || (isDarkMode ? '#d4d4d4' : '#000000'),
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: 0,
  padding: 0,
});

/**
 * Get styles for line number <span> elements (table-cell layout)
 */
export const getLineNumberStyles = (overrides: CSSProperties = {}): CSSProperties => ({
  display: "table-cell",
  textAlign: "right",
  paddingRight: "1em",
  userSelect: "none",
  opacity: 0.5,
  border: 'none',
  ...overrides,
});

/**
 * Get styles for inline line number <span> elements (inline-block layout)
 */
export const getInlineLineNumberStyles = (overrides: CSSProperties = {}): CSSProperties => ({
  display: "inline-block",
  width: "2em",
  userSelect: "none",
  opacity: 0.5,
  marginRight: "1em",
  border: 'none',
  ...overrides,
});

/**
 * Get styles for token container <span> elements (table-cell layout)
 */
export const getTokenContainerStyles = (): CSSProperties => ({
  display: "table-cell",
  border: 'none',
});
