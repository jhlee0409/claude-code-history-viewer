export const PREVIEW_MAX_LEN = 6000;

export type ToolResultLike = Record<string, unknown>;

export interface Props {
  toolUse: Record<string, unknown>;
  toolResults: ToolResultLike[];
  onViewSubagent?: (agentId: string) => void;
}

export const truncate = (text: string, max = PREVIEW_MAX_LEN) =>
  text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`;

export const str = (obj: Record<string, unknown>, key: string): string | null =>
  typeof obj[key] === "string" ? (obj[key] as string) : null;

export const num = (obj: Record<string, unknown>, key: string): number | null =>
  typeof obj[key] === "number" ? (obj[key] as number) : null;

export const isError = (result: ToolResultLike) => {
  if (result.is_error === true) return true;
  const c = result.content;
  if (typeof c === "string" && /^error\b/i.test(c)) return true;
  if (c && typeof c === "object" && "error_code" in c) return true;
  return false;
};
