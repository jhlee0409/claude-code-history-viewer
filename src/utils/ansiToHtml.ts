import Convert from "ansi-to-html";

const converter = new Convert({
  fg: "var(--foreground)",
  bg: "transparent",
  escapeXML: true,
  newline: false,
});

/**
 * Regex pattern for detecting ANSI SGR (Select Graphic Rendition) sequences.
 * Matches sequences like `\x1b[31m` (color), `\x1b[1m` (bold), etc.
 * 
 * Note: This pattern only matches SGR sequences ending with 'm' (color/style codes).
 * It does not match other ANSI escape sequences like cursor movement, screen clearing,
 * or other CSI (Control Sequence Introducer) sequences. This is sufficient for
 * Claude Code's terminal output, which primarily uses SGR codes for styling.
 */
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[\d;]*m/;

/**
 * Returns true if the string contains ANSI SGR escape sequences.
 */
export function hasAnsiCodes(text: string): boolean {
  return ANSI_REGEX.test(text);
}

/**
 * Strip ANSI SGR escape codes from a string, returning plain text.
 * Uses global flag for replacement to remove all occurrences.
 */
export function stripAnsiCodes(text: string): string {
  return text.replace(new RegExp(ANSI_REGEX.source, "g"), "");
}

/**
 * Convert ANSI escape codes to HTML spans with inline styles.
 * Always returns HTML-safe output (non-ANSI text is HTML-escaped).
 */
export function ansiToHtml(text: string): string {
  return converter.toHtml(text);
}
