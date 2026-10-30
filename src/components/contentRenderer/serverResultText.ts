/**
 * The texts of server / API result blocks the conversation search counts
 * (`utils/searchIndex.ts` `extractSearchableText`, the same fields): a call
 * row opens for a hit in its results and its result bodies mark it (TR1b).
 */

import { serverToolTexts } from "@/utils/anthropicServerTools";

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (record: Record<string, unknown>, ...keys: string[]) => keys.flatMap((key) => (typeof record[key] === "string" ? [record[key] as string] : []));

export function serverResultTexts(blocks: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const body = block.content;
    out.push(...serverToolTexts(block.type, body));
    switch (block.type) {
      case "web_search_tool_result":
        if (Array.isArray(body)) for (const item of body) if (isRecord(item)) out.push(...strings(item, "title", "url"));
        if (isRecord(body)) out.push(...strings(body, "title", "url"));
        break;
      case "mcp_tool_result":
        if (typeof body === "string") out.push(body);
        if (isRecord(body)) out.push(...strings(body, "text", "uri"));
        if (Array.isArray(body)) for (const item of body) if (isRecord(item)) out.push(...strings(item, "text", "uri"));
        break;
      case "web_fetch_tool_result":
        if (isRecord(body)) {
          out.push(...strings(body, "url"));
          if (isRecord(body.content)) out.push(...strings(body.content, "title"));
        }
        break;
      case "code_execution_tool_result":
      case "bash_code_execution_tool_result":
        if (isRecord(body)) out.push(...strings(body, "stdout", "stderr"));
        break;
      case "text_editor_code_execution_tool_result":
        if (isRecord(body)) out.push(...strings(body, "path", "content"));
        break;
      case "tool_search_tool_result":
        if (Array.isArray(body)) for (const item of body) if (isRecord(item)) out.push(...strings(item, "tool_name", "server_name", "description"));
        break;
    }
  }
  return out;
}
