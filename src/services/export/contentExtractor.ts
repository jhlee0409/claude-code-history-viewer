/**
 * Content Extractor
 *
 * Shared utility for extracting readable text from ClaudeMessage content.
 * Used by all export format converters.
 */

import type { ContentItem } from "@/types/core/tool";
import type { ClaudeMessage } from "@/types";

export interface ExtractedBlock {
  kind: "text" | "thinking" | "tool" | "result" | "media" | "search" | "code";
  text: string;
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(input)) {
    if (val == null) continue;
    if (typeof val === "string") {
      const truncated = val.length > 120 ? `${val.slice(0, 120)}...` : val;
      parts.push(`${key}: ${truncated}`);
    } else if (typeof val === "boolean" || typeof val === "number") {
      parts.push(`${key}: ${val}`);
    }
  }
  return parts.join(", ");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * Safely read a nested field from an untyped content object.
 * ContentItem union is wide — we use runtime checks to access nested data.
 */
function nested(item: Record<string, unknown>, key: string): unknown {
  return (item.content as Record<string, unknown> | undefined)?.[key];
}

export function extractBlocks(content: string | ContentItem[] | Record<string, unknown> | undefined): ExtractedBlock[] {
  if (content == null) return [];
  if (typeof content === "string") return [{ kind: "text", text: content }];
  if (!Array.isArray(content)) return [];

  const blocks: ExtractedBlock[] = [];

  for (const item of content) {
    if (item == null || typeof item !== "object" || !("type" in item)) continue;
    // Cast for flexible field access across the wide ContentItem union
    const raw = item as unknown as Record<string, unknown>;

    switch (item.type) {
      case "text":
        if ("text" in raw && typeof raw.text === "string") {
          blocks.push({ kind: "text", text: raw.text });
        }
        break;

      case "thinking":
        if ("thinking" in raw && typeof raw.thinking === "string") {
          blocks.push({ kind: "thinking", text: raw.thinking });
        }
        break;

      case "redacted_thinking":
        blocks.push({ kind: "thinking", text: "[Redacted thinking]" });
        break;

      case "tool_use":
        if ("name" in raw && typeof raw.name === "string") {
          const input = typeof raw.input === "object" && raw.input != null
            ? summarizeInput(raw.input as Record<string, unknown>)
            : "";
          const detail = input ? `${raw.name}(${input})` : raw.name;
          blocks.push({ kind: "tool", text: detail });
        }
        break;

      case "tool_result":
        if ("content" in raw) {
          const c = raw.content;
          const isError = raw.is_error === true;
          const prefix = isError ? "[Error] " : "";
          if (typeof c === "string") {
            blocks.push({ kind: "result", text: `${prefix}${truncate(c, 500)}` });
          } else {
            blocks.push({ kind: "result", text: `${prefix}[Tool result]` });
          }
        }
        break;

      // ServerToolUseContent: { name, input }
      case "server_tool_use":
        if (typeof raw.name === "string") {
          const input = typeof raw.input === "object" && raw.input != null
            ? summarizeInput(raw.input as Record<string, unknown>)
            : "";
          const detail = input ? `${raw.name}(${input})` : raw.name;
          blocks.push({ kind: "tool", text: `[Server: ${detail}]` });
        }
        break;

      // WebSearchToolResultContent: { content: WebSearchResultItem[] | WebSearchToolError }
      // WebSearchResultItem: { type: "web_search_result", title, url }
      case "web_search_tool_result": {
        const c = raw.content;
        if (Array.isArray(c)) {
          const urls = c
            .slice(0, 5)
            .map((r: Record<string, unknown>) => r.title ?? r.url ?? "")
            .filter(Boolean)
            .join(", ");
          blocks.push({ kind: "search", text: urls ? `[Web search: ${urls}]` : "[Web search results]" });
        } else {
          blocks.push({ kind: "search", text: "[Web search results]" });
        }
        break;
      }

      // WebFetchToolResultContent: { content: WebFetchResult | WebFetchError }
      // WebFetchResult: { type: "web_fetch_result", url, content? }
      case "web_fetch_tool_result": {
        const c = raw.content as Record<string, unknown> | undefined;
        const url = typeof c?.url === "string" ? c.url : undefined;
        blocks.push({ kind: "search", text: url ? `[Web fetch: ${url}]` : "[Web fetch result]" });
        break;
      }

      // CodeExecutionToolResultContent: { content: { stdout?, stderr? } }
      case "code_execution_tool_result":
      case "bash_code_execution_tool_result": {
        const stdout = nested(raw, "stdout");
        const stderr = nested(raw, "stderr");
        const output = typeof stdout === "string" && stdout ? truncate(stdout, 300) : "";
        const err = typeof stderr === "string" && stderr ? `[stderr] ${truncate(stderr, 200)}` : "";
        const text = [output, err].filter(Boolean).join("\n") || `[${item.type}]`;
        blocks.push({ kind: "code", text });
        break;
      }

      // TextEditorCodeExecutionToolResultContent: { content: { operation?, path?, success? } }
      case "text_editor_code_execution_tool_result": {
        const c = raw.content as Record<string, unknown> | undefined;
        const op = typeof c?.operation === "string" ? c.operation : "unknown";
        const path = typeof c?.path === "string" ? c.path : "";
        blocks.push({ kind: "code", text: path ? `[File ${op}: ${path}]` : `[File ${op}]` });
        break;
      }

      case "tool_search_tool_result":
        blocks.push({ kind: "result", text: "[Tool search result]" });
        break;

      case "image":
        blocks.push({ kind: "media", text: "[Image]" });
        break;

      case "document":
        if (typeof raw.title === "string") {
          blocks.push({ kind: "media", text: `[Document: ${raw.title}]` });
        } else {
          blocks.push({ kind: "media", text: "[Document]" });
        }
        break;

      case "search_result":
        if (typeof raw.title === "string") {
          blocks.push({ kind: "search", text: `[Search: ${raw.title}]` });
        } else {
          blocks.push({ kind: "search", text: "[Search result]" });
        }
        break;

      // MCPToolUseContent: { server_name, tool_name, input }
      case "mcp_tool_use": {
        const server = typeof raw.server_name === "string" ? raw.server_name : "";
        const tool = typeof raw.tool_name === "string" ? raw.tool_name : "";
        const name = server && tool ? `${server}.${tool}` : tool || server || "unknown";
        const input = typeof raw.input === "object" && raw.input != null
          ? summarizeInput(raw.input as Record<string, unknown>)
          : "";
        const detail = input ? `${name}(${input})` : name;
        blocks.push({ kind: "tool", text: `[MCP: ${detail}]` });
        break;
      }

      // MCPToolResultContent: { content: MCPToolResultData | string, is_error? }
      case "mcp_tool_result": {
        const c = raw.content;
        const isError = raw.is_error === true;
        const prefix = isError ? "[Error] " : "";
        if (typeof c === "string") {
          blocks.push({ kind: "result", text: `${prefix}${truncate(c, 500)}` });
        } else if (typeof c === "object" && c != null && "text" in (c as Record<string, unknown>)) {
          const text = (c as Record<string, unknown>).text;
          if (typeof text === "string") {
            blocks.push({ kind: "result", text: `${prefix}${truncate(text, 500)}` });
          } else {
            blocks.push({ kind: "result", text: `${prefix}[MCP result]` });
          }
        } else {
          blocks.push({ kind: "result", text: `${prefix}[MCP result]` });
        }
        break;
      }

      default:
        blocks.push({ kind: "text", text: `[${String(raw.type)}]` });
        break;
    }
  }

  return blocks;
}

/**
 * Filter messages to only exportable types (shared across all exporters).
 */
export function isExportable(m: ClaudeMessage): boolean {
  return !m.isSidechain
    && m.type !== "system"
    && m.type !== "summary"
    && m.type !== "progress"
    && m.type !== "queue-operation"
    && m.type !== "file-history-snapshot";
}

/**
 * Filter extracted blocks by content type toggles.
 * Maps MessageFilterContentTypes keys to ExtractedBlock kinds.
 *
 * Note: "commands" filter is handled at the renderer level (skipCommands prop)
 * since extractBlocks() does not produce a dedicated "command" block kind —
 * command XML content is either stripped or included as "text".
 */
export function filterBlocksByContentType(
  blocks: ExtractedBlock[],
  contentTypes: { text: boolean; thinking: boolean; toolCalls: boolean; commands: boolean },
): ExtractedBlock[] {
  return blocks.filter((block) => {
    switch (block.kind) {
      case "text": return contentTypes.text;
      case "thinking": return contentTypes.thinking;
      case "tool":
      case "result":
      case "code": return contentTypes.toolCalls;
      case "media":
      case "search": return true; // always include media/search
      default: return true;
    }
  });
}

/**
 * Flatten blocks to plain text (for JSON export).
 */
export function blocksToPlainText(blocks: ExtractedBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}
