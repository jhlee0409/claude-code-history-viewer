import { stripAnsiCodes } from "@/utils/ansiToHtml";

/** Search-only text: retain compatible JSON matching and decoded string values,
 * normalized before JSON escapes hide their boundaries. Display/copy stay raw.
 * Callers must gate empty queries before doing this work.
 */
export function resultSearchText(value: unknown): string {
  const strings: string[] = [];
  const serialized = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== "string") return v;
    const text = stripAnsiCodes(v);
    strings.push(text);
    return text;
  });
  return serialized === undefined ? "" : [serialized, ...strings].join("\n");
}
