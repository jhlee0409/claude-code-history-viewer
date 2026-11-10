import type { ClaudeMessage } from "@/types";
import type { MessageFilterContentTypes } from "@/store/slices/filterSlice";
import { isDocumentContent, isSearchResultContent } from "@/utils/contentTypeGuards";
import { SERVER_RESULT_TYPES, type ContentEntry } from "./contentEntries";

export interface ContentVisibility {
  skipText?: boolean;
  skipFirstText?: boolean;
  firstTextIndex?: number;
  skipThinking?: boolean;
  skipCommands?: boolean;
  skipToolCalls?: boolean;
  skipToolResults?: boolean;
}

/** Content filters apply to assistant bodies only; user/other bodies are unchanged. */
export function messageContentVisibility(message: ClaudeMessage, contentTypes?: MessageFilterContentTypes): ContentVisibility {
  const assistant = message.type === "assistant";
  return {
    skipText: assistant && contentTypes?.text === false,
    skipThinking: assistant && contentTypes?.thinking === false,
    skipCommands: assistant && contentTypes?.commands === false,
    skipToolCalls: assistant && contentTypes?.toolCalls === false,
  };
}

/** The production entry renderer's null-return policy, without trimming source data.
 * Pair first, then project: a hidden call owns its results even when filtered out.
 * The first text's message-bubble ownership is a caller concern (skipFirstText).
 */
export function contentEntryVisible(entry: ContentEntry, options: ContentVisibility = {}): boolean {
  if (entry.kind !== "item") return !options.skipToolCalls;
  const { item, index } = entry;
  if (item === null || typeof item !== "object") return true;
  const value = item as Record<string, unknown>;
  switch (value.type) {
    case "text":
      return !options.skipText && !(options.skipFirstText && index === options.firstTextIndex) && typeof value.text === "string";
    case "thinking":
      return !options.skipThinking && typeof value.thinking === "string" && !!value.thinking;
    case "redacted_thinking":
      return !options.skipThinking;
    case "tool_use":
      return !options.skipToolCalls;
    case "tool_result":
      return !options.skipToolCalls && !options.skipToolResults;
    case "command":
      return !options.skipCommands && typeof value.content === "string" && !!value.content;
    case "image": {
      const source = value.source as Record<string, unknown> | null;
      return !!source && typeof source === "object" && (
        (source.type === "base64" && !!source.data && !!source.media_type) ||
        (source.type === "url" && typeof source.url === "string")
      );
    }
    case "document": return isDocumentContent(item);
    case "search_result": return isSearchResultContent(item);
    default:
      return !SERVER_RESULT_TYPES.has(value.type as string) || (!options.skipToolCalls && !options.skipToolResults);
  }
}
