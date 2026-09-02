export const PREVIEW_MAX_LEN = 6000;

export type ToolResultLike = Record<string, unknown>;

export interface Props {
  toolUse: Record<string, unknown>;
  toolResults: ToolResultLike[];
  onViewSubagent?: (toolUseId: string) => void;
  searchQuery?: string;
  isCurrentMatch?: boolean;
  currentMatchIndex?: number;
}

export const truncate = (text: string, max = PREVIEW_MAX_LEN) =>
  text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;

export const str = (obj: Record<string, unknown>, key: string): string | null =>
  typeof obj[key] === "string" ? (obj[key] as string) : null;

export const num = (obj: Record<string, unknown>, key: string): number | null =>
  typeof obj[key] === "number" ? (obj[key] as number) : null;

/** First string value among `keys`, in priority order. */
export const strAny = (obj: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const v = str(obj, key);
    if (v != null && v.length > 0) return v;
  }
  return null;
};

const SUMMARY_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "prompt",
  "description",
  "title",
  // oh-my-pi / pi tools carry a short "intent" string.
  "i",
] as const;
export const SUMMARY_MAX_LEN = 120;

/**
 * One-line preview of a tool input for the collapsed card header.
 * Picks the most informative string field, keeps its first line, and caps length.
 */
export const summarizeToolInput = (input: Record<string, unknown>): string | undefined => {
  const value = strAny(input, ...SUMMARY_KEYS);
  if (value == null) return undefined;
  const firstLine = value.trimStart().split("\n")[0]?.trim() ?? "";
  if (firstLine.length === 0) return undefined;
  return firstLine.length > SUMMARY_MAX_LEN ? `${firstLine.slice(0, SUMMARY_MAX_LEN)}…` : firstLine;
};

export const isError = (result: ToolResultLike) => {
  if (result.is_error === true) return true;
  const c = result.content;
  if (typeof c === "string" && /^error\b/i.test(c)) return true;
  if (c && typeof c === "object" && "error_code" in c) return true;
  return false;
};
