/** Claude local structural recount (111 JSONL files, 29,432 records): 313/318
 * WebSearch results are [{tool_use_id, content:[{title,url},…]}, commentary].
 * All 2,965 entries across 324 batches have string title/url. No record content
 * retained. Reproduce: docs/contracts/anthropic-server-tools.md. Strings are
 * commentary, never hits; count the links across every recorded batch. */
/** Searchable SDK plaintext only; encrypted_content is deliberately opaque.
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L7085-L7192
 * https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/beta/messages/messages.ts#L8010-L8057 */
export function serverToolTexts(type: unknown, content: unknown): string[] {
  if (content == null || typeof content !== "object" || Array.isArray(content)) return [];
  const c = content as Record<string, unknown>;
  const out: string[] = [];
  if (type === "text_editor_code_execution_tool_result" && c.type === "text_editor_code_execution_str_replace_result" && Array.isArray(c.lines)) out.push(...c.lines.filter((v): v is string => typeof v === "string"));
  if (type === "tool_search_tool_result" && c.type === "tool_search_tool_search_result" && Array.isArray(c.tool_references)) for (const ref of c.tool_references) {
    if (ref != null && typeof ref === "object" && ref.type === "tool_reference" && typeof ref.tool_name === "string") out.push(ref.tool_name);
  }
  if ((type === "text_editor_code_execution_tool_result" || type === "tool_search_tool_result") && typeof c.error_message === "string") out.push(c.error_message);
  return out;
}

export function webSearchLinks(results: unknown): Record<string, unknown>[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap(item => {
    if (item == null || typeof item !== "object" || Array.isArray(item)) return [];
    if (typeof item.url === "string") return [item as Record<string, unknown>];
    return Array.isArray(item.content) ? item.content.filter((link: unknown): link is Record<string, unknown> => link != null && typeof link === "object" && !Array.isArray(link) && "url" in link && typeof link.url === "string") : [];
  });
}
