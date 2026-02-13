import Convert from "ansi-to-html";

const converter = new Convert({
  fg: "var(--foreground)",
  bg: "transparent",
  escapeXML: true,
  newline: false,
});

/**
 * Returns true if the string contains ANSI escape sequences.
 */
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[\d;]*m/;

export function hasAnsiCodes(text: string): boolean {
  return ANSI_REGEX.test(text);
}

/**
 * Strip ANSI escape codes from a string, returning plain text.
 */
export function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[\d;]*m/g, "");
}

/**
 * Convert ANSI escape codes to HTML spans with inline styles.
 * Always returns HTML-safe output (non-ANSI text is HTML-escaped).
 */
export function ansiToHtml(text: string): string {
  return converter.toHtml(text);
}
