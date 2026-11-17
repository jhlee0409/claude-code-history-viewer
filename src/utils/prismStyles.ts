/**
 * Prism React Renderer Style Utilities
 *
 * Provides consistent styling for code highlighting across all components.
 * Overrides prism theme token styles to prevent unwanted backgrounds, borders, etc.
 */

import type { CSSProperties } from "react";
import { themes, type PrismTheme } from "prism-react-renderer";

const SYNTAX_ROLES: Record<string, string> = {
  prolog: "comment", comment: "comment",
  builtin: "keyword", changed: "keyword", keyword: "keyword",
  "interpolation-punctuation": "punct",
  number: "number", inserted: "number", constant: "number",
  "attr-name": "type", variable: "type", tag: "type", "class-name": "type",
  deleted: "string", string: "string", "attr-value": "string",
  "template-punctuation": "punct", char: "string",
  selector: "function", function: "function", punctuation: "punct", operator: "punct",
};

/** Compatibility with existing callers, which pass only Prism's resolved
 * style, not the token type. Translate the dependency's colour groups once;
 * no dependency colour escapes to the DOM. Shared legacy groups retain one
 * role (e.g. VS Light's function/keyword), not an invented type distinction.
 * Unknown/custom theme colours fall back to the readable foreground. */
function syntaxColors(theme: PrismTheme): Map<string, string> {
  const colors = new Map<string, string>();
  for (const { types, style } of theme.styles) {
    const role = types.map((type) => SYNTAX_ROLES[type]).find(Boolean);
    if (style.color && role && !colors.has(style.color)) colors.set(style.color, `var(--code-${role})`);
  }
  return colors;
}
const SYNTAX_COLORS = [syntaxColors(themes.vsLight), syntaxColors(themes.vsDark)];

/**
 * Get styles for the <pre> element
 */
export const getPreStyles = (
  _isDarkMode: boolean,
  baseStyle: CSSProperties,
  overrides: CSSProperties = {}
): CSSProperties => ({
  ...baseStyle,
  backgroundColor: "var(--surface-well)",
  color: "var(--fg)",
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
  color: SYNTAX_COLORS[Number(isDarkMode)]?.get(baseStyle.color ?? "") ?? "var(--fg)",
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
