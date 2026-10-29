import { stripAnsiCodes } from "@/utils/ansiToHtml";

/** Search-only serialization: normalize real string values before JSON escapes
 * hide their ANSI boundaries. Display/copy always retain the original record.
 * Callers must gate empty queries before doing this work.
 */
export function resultSearchText(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => typeof v === "string" ? stripAnsiCodes(v) : v) ?? "";
}
