const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Local wall-clock stamp with milliseconds (`19:07:47.006`): requests and
 * the lines around them are milliseconds apart, which the app's clock
 * formats (minutes) cannot show.
 */
export function clockStamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** A line that is only an opening or closing tag, such as `<system-reminder>`. */
const BARE_TAG = /^<\/?[\w-]+(\s[^>]*)?>$/;

/** The first line of a preview that says something. */
export function previewHeadline(preview: string): string {
  const lines = preview.split("\n").map((l) => l.trim());
  return lines.find((l) => l !== "" && !BARE_TAG.test(l)) ?? lines[0] ?? "";
}
