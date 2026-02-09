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
 * Convert ANSI escape codes to HTML spans with inline styles.
 * Returns the original string if no ANSI codes are present.
 */
export function ansiToHtml(text: string): string {
  if (!hasAnsiCodes(text)) return text;
  return converter.toHtml(text);
}
