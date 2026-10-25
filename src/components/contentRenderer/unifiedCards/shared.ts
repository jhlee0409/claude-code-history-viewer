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

/** Summary keys whose value is a file path: the row shows it the PathText way (relative, D1). */
const PATH_KEYS = new Set<string>(["file_path", "path"]);

/** The input field a collapsed row names as its target. */
export interface InputSummary {
  /** The input key it came from. */
  key: string;
  /** The value's first line, whole. */
  line: string;
  /** What the row shows: the first line, capped at `SUMMARY_MAX_LEN` with "…". */
  text: string;
  /** The value is a path (`file_path` / `path`). */
  isPath: boolean;
}

/**
 * The most informative string field of a tool input, for the row's target:
 * the first summary key with a non-empty value, its first line, capped in
 * length (the old card header's one-line preview, same keys and order).
 */
export const inputSummary = (input: Record<string, unknown>): InputSummary | undefined => {
  const key = SUMMARY_KEYS.find((k) => (str(input, k) ?? "").length > 0);
  if (key === undefined) return undefined;
  const line = (str(input, key) ?? "").trimStart().split("\n")[0]?.trim() ?? "";
  if (line.length === 0) return undefined;
  const text = line.length > SUMMARY_MAX_LEN ? `${line.slice(0, SUMMARY_MAX_LEN)}…` : line;
  return { key, line, text, isPath: PATH_KEYS.has(key) };
};

/**
 * One line of Markdown as plain words, for a row target (renderer audit NC3:
 * no raw `**` in a preview): the first non-empty line without heading, list
 * and quote markers, emphasis / code marks and link targets.
 */
export const plainPreview = (markdown: string): string => {
  const line = markdown.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*([^*]+)\*/g, "$1")
    // `_x_` only as emphasis, not inside snake_case words.
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .trim();
};

/** Does `query` (case-insensitive, trimmed) occur in any of `texts`? An empty query never does. */
export const searchHits = (query: string | undefined, ...texts: (string | null | undefined)[]): boolean => {
  const q = query?.trim().toLowerCase() ?? "";
  if (q === "") return false;
  return texts.some((text) => typeof text === "string" && text.toLowerCase().includes(q));
};
