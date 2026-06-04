/**
 * Search Index Web Worker
 *
 * Runs FlexSearch indexing and search operations off the main thread
 * to prevent UI blocking when handling large message sets (47k+).
 */

import FlexSearch from "flexsearch";
import type { Document as FlexSearchDocument } from "flexsearch";

// ============================================================================
// Types (duplicated here since workers can't import from main thread modules)
// ============================================================================

interface ClaudeMessageMinimal {
  uuid: string;
  type: string;
  content: unknown;
  toolUse?: unknown;
  toolUseResult?: unknown;
}

type SearchFilterType = "content" | "toolId";

// FlexSearch document shape used by this worker's content / toolId indexes
type SearchDoc = { uuid: string; messageIndex: number; text: string };
type FlexSearchDocumentIndex = FlexSearchDocument<SearchDoc>;

// ============================================================================
// Worker Message Protocol
// ============================================================================

interface BuildMessage {
  type: "build";
  messages: ClaudeMessageMinimal[];
}

interface SearchMessage {
  type: "search";
  id: number;
  query: string;
  filterType: SearchFilterType;
}

interface ClearMessage {
  type: "clear";
}

type IncomingMessage = BuildMessage | SearchMessage | ClearMessage;

interface BuildCompleteResponse {
  type: "build-complete";
  count: number;
}

interface SearchResultResponse {
  type: "search-result";
  id: number;
  results: Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }>;
}

type OutgoingMessage = BuildCompleteResponse | SearchResultResponse;

// ============================================================================
// Text Extraction (same logic as main thread searchIndex.ts)
// ============================================================================

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasStringProperty = (obj: Record<string, unknown>, key: string): boolean => {
  return key in obj && typeof obj[key] === "string";
};

const MAX_TEXT_LENGTH = 10000;

const extractSearchableText = (message: ClaudeMessageMinimal): string => {
  const parts: string[] = [];
  try {
    if (message.content) {
      if (typeof message.content === "string") {
        parts.push(message.content);
      } else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (typeof item === "string") {
            parts.push(item);
          } else if (isRecord(item)) {
            if (item.type === "image") continue;
            if (hasStringProperty(item, "text")) parts.push((item.text as string).slice(0, MAX_TEXT_LENGTH));
            if (hasStringProperty(item, "thinking")) parts.push((item.thinking as string).slice(0, MAX_TEXT_LENGTH));
            if (item.type === "tool_use" && hasStringProperty(item, "name")) parts.push(item.name as string);
            if (item.type === "tool_result" && hasStringProperty(item, "content")) parts.push(item.content as string);
            if (item.type === "server_tool_use" && hasStringProperty(item, "name")) parts.push(item.name as string);
          }
        }
      }
    }
    if (message.type === "assistant" && isRecord(message.toolUse) && hasStringProperty(message.toolUse, "name")) {
      parts.push(message.toolUse.name as string);
    }
    const MAX_CONTENT_LENGTH = 5000;
    if ((message.type === "user" || message.type === "assistant") && message.toolUseResult) {
      const result = message.toolUseResult;
      if (typeof result === "string") {
        parts.push(result.slice(0, MAX_CONTENT_LENGTH));
      } else if (isRecord(result)) {
        if (hasStringProperty(result, "stdout")) parts.push((result.stdout as string).slice(0, MAX_CONTENT_LENGTH));
        if (hasStringProperty(result, "stderr")) parts.push((result.stderr as string).slice(0, MAX_CONTENT_LENGTH));
        if (hasStringProperty(result, "content")) parts.push((result.content as string).slice(0, MAX_CONTENT_LENGTH));
      }
    }
  } catch {
    // ignore extraction errors
  }
  return parts.join(" ");
};

const extractToolIds = (message: ClaudeMessageMinimal): string => {
  const ids: string[] = [];
  try {
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (isRecord(item)) {
          if (item.type === "tool_use" && hasStringProperty(item, "id")) ids.push(item.id as string);
          if (item.type === "tool_result" && hasStringProperty(item, "tool_use_id")) ids.push(item.tool_use_id as string);
        }
      }
    }
    if (message.type === "assistant" && isRecord(message.toolUse) && hasStringProperty(message.toolUse, "id")) {
      ids.push(message.toolUse.id as string);
    }
  } catch {
    // ignore
  }
  return ids.join(" ");
};

// ============================================================================
// FlexSearch Index
// ============================================================================

const createFlexSearchIndex = (): FlexSearchDocumentIndex => {
  return new FlexSearch.Document({
    tokenize: "forward",
    cache: 100,
    document: {
      id: "uuid",
      index: ["text"],
      store: ["uuid", "messageIndex"],
    },
  });
};

let contentIndex: FlexSearchDocumentIndex = createFlexSearchIndex();
let toolIdIndex: FlexSearchDocumentIndex = createFlexSearchIndex();
const messageMap = new Map<string, number>();
let messages: ClaudeMessageMinimal[] = [];
let isBuilt = false;

function clearIndex() {
  contentIndex = createFlexSearchIndex();
  toolIdIndex = createFlexSearchIndex();
  messageMap.clear();
  messages = [];
  isBuilt = false;
}

function buildIndex(msgs: ClaudeMessageMinimal[]) {
  clearIndex();
  messages = msgs;

  for (let i = 0; i < msgs.length; i++) {
    const message = msgs[i];
    if (!message) continue;

    const text = extractSearchableText(message);
    if (text.trim()) {
      contentIndex.add({ uuid: message.uuid, messageIndex: i, text: text.toLowerCase() });
    }

    const toolIds = extractToolIds(message);
    if (toolIds.trim()) {
      toolIdIndex.add({ uuid: message.uuid, messageIndex: i, text: toolIds.toLowerCase() });
    }

    messageMap.set(message.uuid, i);
  }

  isBuilt = true;
}

function searchIndex(
  query: string,
  filterType: SearchFilterType
): Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }> {
  if (!isBuilt || !query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const index = filterType === "toolId" ? toolIdIndex : contentIndex;

  const results = index.search(lowerQuery, { limit: 1000, enrich: true });
  const matchedUuids = new Set<string>();
  // FlexSearch's enriched result type is complex; cast to the shape we actually consume.
  const enrichedResults = results as unknown as Array<{ result: Array<string | { id: string }> }>;
  enrichedResults.forEach((fieldResult) => {
    if (fieldResult.result) {
      fieldResult.result.forEach((item: string | { id: string }) => {
        matchedUuids.add(typeof item === "string" ? item : item.id);
      });
    }
  });

  const allMatches: Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }> = [];
  matchedUuids.forEach((uuid) => {
    const messageIndex = messageMap.get(uuid);
    if (messageIndex === undefined) return;
    const message = messages[messageIndex];
    if (!message) return;

    const text = filterType === "toolId" ? extractToolIds(message) : extractSearchableText(message);
    const lowerText = text.toLowerCase();
    let count = 0;
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      count++;
      pos += lowerQuery.length;
    }

    for (let matchIdx = 0; matchIdx < count; matchIdx++) {
      allMatches.push({ messageUuid: uuid, messageIndex, matchIndex: matchIdx, matchCount: count });
    }
  });

  allMatches.sort((a, b) => b.messageIndex - a.messageIndex || b.matchIndex - a.matchIndex);
  return allMatches;
}

// ============================================================================
// Worker Message Handler
// ============================================================================

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "build": {
      buildIndex(msg.messages);
      const response: BuildCompleteResponse = { type: "build-complete", count: msg.messages.length };
      self.postMessage(response satisfies OutgoingMessage);
      break;
    }
    case "search": {
      const results = searchIndex(msg.query, msg.filterType);
      const response: SearchResultResponse = { type: "search-result", id: msg.id, results };
      self.postMessage(response satisfies OutgoingMessage);
      break;
    }
    case "clear": {
      clearIndex();
      break;
    }
  }
};
