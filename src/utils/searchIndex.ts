import FlexSearch from "flexsearch";
import type { ClaudeMessage } from "../types";
import type { SearchFilterType } from "../store/useAppStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexSearchDocumentIndex = any;

// Type guards for safe type checking
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasStringProperty = (obj: Record<string, unknown>, key: string): boolean => {
  return key in obj && typeof obj[key] === "string";
};

// 검색 가능한 텍스트 추출 (content 검색용)
const extractSearchableText = (message: ClaudeMessage): string => {
  const parts: string[] = [];

  try {
    // content 추출
    if (message.content) {
      if (typeof message.content === "string") {
        parts.push(message.content);
      } else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (typeof item === "string") {
            parts.push(item);
          } else if (isRecord(item)) {
            const itemType = item.type as string | undefined;

            // text content
            if (hasStringProperty(item, "text")) {
              parts.push(item.text as string);
            }
            // thinking content
            if (hasStringProperty(item, "thinking")) {
              parts.push(item.thinking as string);
            }
            // tool_use: name
            if (itemType === "tool_use" && hasStringProperty(item, "name")) {
              parts.push(item.name as string);
            }
            // tool_result: content
            if (itemType === "tool_result" && hasStringProperty(item, "content")) {
              parts.push(item.content as string);
            }
            // server_tool_use: name
            if (itemType === "server_tool_use" && hasStringProperty(item, "name")) {
              parts.push(item.name as string);
            }
            // web_search_tool_result: titles and urls
            if (itemType === "web_search_tool_result" && isRecord(item.content)) {
              extractWebSearchResults(item.content, parts);
            } else if (itemType === "web_search_tool_result" && Array.isArray(item.content)) {
              for (const result of item.content) {
                if (isRecord(result)) {
                  if (hasStringProperty(result, "title")) parts.push(result.title as string);
                  if (hasStringProperty(result, "url")) parts.push(result.url as string);
                }
              }
            }
            // document: title, context
            if (itemType === "document") {
              if (hasStringProperty(item, "title")) parts.push(item.title as string);
              if (hasStringProperty(item, "context")) parts.push(item.context as string);
              // Also extract text content from PlainTextSource
              if (isRecord(item.source) && (item.source as Record<string, unknown>).type === "text") {
                const source = item.source as Record<string, unknown>;
                if (hasStringProperty(source, "data")) parts.push(source.data as string);
              }
            }
            // search_result: title, source, content texts
            if (itemType === "search_result") {
              if (hasStringProperty(item, "title")) parts.push(item.title as string);
              if (hasStringProperty(item, "source")) parts.push(item.source as string);
              if (Array.isArray(item.content)) {
                for (const textContent of item.content) {
                  if (isRecord(textContent) && hasStringProperty(textContent, "text")) {
                    parts.push(textContent.text as string);
                  }
                }
              }
            }
            // mcp_tool_use: server_name, tool_name
            if (itemType === "mcp_tool_use") {
              if (hasStringProperty(item, "server_name")) parts.push(item.server_name as string);
              if (hasStringProperty(item, "tool_name")) parts.push(item.tool_name as string);
            }
            // mcp_tool_result: text content
            if (itemType === "mcp_tool_result") {
              extractMCPToolResultText(item.content, parts);
            }
            // web_fetch_tool_result: url, title
            if (itemType === "web_fetch_tool_result" && isRecord(item.content)) {
              const content = item.content as Record<string, unknown>;
              if (hasStringProperty(content, "url")) parts.push(content.url as string);
              if (isRecord(content.content)) {
                const doc = content.content as Record<string, unknown>;
                if (hasStringProperty(doc, "title")) parts.push(doc.title as string);
              }
            }
            // code_execution_tool_result: stdout, stderr
            if (itemType === "code_execution_tool_result" && isRecord(item.content)) {
              const content = item.content as Record<string, unknown>;
              if (hasStringProperty(content, "stdout")) parts.push(content.stdout as string);
              if (hasStringProperty(content, "stderr")) parts.push(content.stderr as string);
            }
            // bash_code_execution_tool_result: stdout, stderr
            if (itemType === "bash_code_execution_tool_result" && isRecord(item.content)) {
              const content = item.content as Record<string, unknown>;
              if (hasStringProperty(content, "stdout")) parts.push(content.stdout as string);
              if (hasStringProperty(content, "stderr")) parts.push(content.stderr as string);
            }
            // text_editor_code_execution_tool_result: path, content
            if (itemType === "text_editor_code_execution_tool_result" && isRecord(item.content)) {
              const content = item.content as Record<string, unknown>;
              if (hasStringProperty(content, "path")) parts.push(content.path as string);
              if (hasStringProperty(content, "content")) parts.push(content.content as string);
            }
            // tool_search_tool_result: tool names, descriptions
            if (itemType === "tool_search_tool_result" && Array.isArray(item.content)) {
              for (const result of item.content) {
                if (isRecord(result)) {
                  if (hasStringProperty(result, "tool_name")) parts.push(result.tool_name as string);
                  if (hasStringProperty(result, "server_name")) parts.push(result.server_name as string);
                  if (hasStringProperty(result, "description")) parts.push(result.description as string);
                }
              }
            }
          }
        }
      }
    }

    // toolUse name 추출
    if (isRecord(message.toolUse) && hasStringProperty(message.toolUse, "name")) {
      parts.push(message.toolUse.name as string);
    }

    // toolUseResult 추출
    if (message.toolUseResult) {
      const result = message.toolUseResult;
      if (typeof result === "string") {
        parts.push(result);
      } else if (isRecord(result)) {
        if (hasStringProperty(result, "stdout")) {
          parts.push(result.stdout as string);
        }
        if (hasStringProperty(result, "stderr")) {
          parts.push(result.stderr as string);
        }
        if (hasStringProperty(result, "content")) {
          parts.push(result.content as string);
        }
      }
    }
  } catch (error) {
    console.error("[SearchIndex] Error extracting searchable text:", error);
  }

  return parts.join(" ");
};

// Helper: Extract text from web search results
const extractWebSearchResults = (content: Record<string, unknown>, parts: string[]): void => {
  if (hasStringProperty(content, "title")) parts.push(content.title as string);
  if (hasStringProperty(content, "url")) parts.push(content.url as string);
};

// Helper: Extract text from MCP tool result
const extractMCPToolResultText = (content: unknown, parts: string[]): void => {
  if (typeof content === "string") {
    parts.push(content);
  } else if (isRecord(content)) {
    if (hasStringProperty(content, "text")) {
      parts.push(content.text as string);
    }
    if (hasStringProperty(content, "uri")) {
      parts.push(content.uri as string);
    }
  }
};

// Tool ID 추출 (tool_use_id, tool_use.id 검색용)
const extractToolIds = (message: ClaudeMessage): string => {
  const ids: string[] = [];

  try {
    // message.content 배열에서 tool_use와 tool_result의 id 추출
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (isRecord(item)) {
          // tool_use의 id
          if (item.type === "tool_use" && hasStringProperty(item, "id")) {
            ids.push(item.id as string);
          }
          // tool_result의 tool_use_id
          if (item.type === "tool_result" && hasStringProperty(item, "tool_use_id")) {
            ids.push(item.tool_use_id as string);
          }
        }
      }
    }

    // toolUse 객체의 id
    if (isRecord(message.toolUse) && hasStringProperty(message.toolUse, "id")) {
      ids.push(message.toolUse.id as string);
    }
  } catch (error) {
    console.error("[SearchIndex] Error extracting tool IDs:", error);
  }

  return ids.join(" ");
};

// FlexSearch Document 인덱스 타입
interface SearchDocument {
  uuid: string;
  messageIndex: number;
  text: string;
}

// FlexSearch enriched 결과 타입
interface EnrichedResult {
  id: string;
  doc?: SearchDocument;
}

// 결과 아이템에서 UUID 추출 (타입 가드)
const extractUuidFromResult = (item: string | EnrichedResult): string => {
  if (typeof item === "string") {
    return item;
  }
  return item.id;
};

// FlexSearch Document 인덱스 생성 헬퍼
const createFlexSearchIndex = (): FlexSearchDocumentIndex => {
  return new FlexSearch.Document({
    tokenize: "forward", // 접두사 매칭 지원
    cache: 100, // 최근 100개 쿼리 캐시
    document: {
      id: "uuid",
      index: ["text"],
      store: ["uuid", "messageIndex"],
    },
  });
};

// 메시지 검색 인덱스 클래스
class MessageSearchIndex {
  private contentIndex: FlexSearchDocumentIndex;
  private toolIdIndex: FlexSearchDocumentIndex;
  private messageMap: Map<string, number> = new Map(); // uuid -> messageIndex
  private messages: ClaudeMessage[] = []; // 메시지 원본 저장 (매치 위치 계산용)
  private isBuilt = false;

  constructor() {
    this.contentIndex = createFlexSearchIndex();
    this.toolIdIndex = createFlexSearchIndex();
  }

  // 인덱스 구축 (메시지 로드 시 1회 호출)
  build(messages: ClaudeMessage[]): void {
    // 기존 인덱스 클리어
    this.clear();

    // 메시지 원본 저장
    this.messages = messages;

    // 새 인덱스 구축
    messages.forEach((message, index) => {
      // Content 인덱스
      const text = extractSearchableText(message);
      if (text.trim()) {
        this.contentIndex.add({
          uuid: message.uuid,
          messageIndex: index,
          text: text.toLowerCase(), // 대소문자 무시
        });
      }

      // Tool ID 인덱스
      const toolIds = extractToolIds(message);
      if (toolIds.trim()) {
        this.toolIdIndex.add({
          uuid: message.uuid,
          messageIndex: index,
          text: toolIds.toLowerCase(),
        });
      }

      this.messageMap.set(message.uuid, index);
    });

    this.isBuilt = true;

    if (import.meta.env.DEV) {
      console.log(`[SearchIndex] Built index for ${messages.length} messages`);
    }
  }

  // 메시지 내 모든 매치 위치 찾기
  private findAllMatchesInText(text: string, query: string): number {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let count = 0;
    let pos = 0;

    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      count++;
      pos += lowerQuery.length;
    }

    return count;
  }

  // 검색 실행
  search(
    query: string,
    filterType: SearchFilterType = "content"
  ): Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }> {
    if (!this.isBuilt || !query.trim()) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const index = filterType === "toolId" ? this.toolIdIndex : this.contentIndex;

    // FlexSearch 검색 (메시지 레벨)
    const results = index.search(lowerQuery, {
      limit: 1000, // 최대 1000개 결과
      enrich: true, // 저장된 데이터 포함
    });

    // 매치된 메시지 UUID 수집
    const matchedUuids = new Set<string>();
    results.forEach((fieldResult: { field: string; result: (string | EnrichedResult)[] }) => {
      if (fieldResult.result) {
        fieldResult.result.forEach((item: string | EnrichedResult) => {
          const uuid = extractUuidFromResult(item);
          matchedUuids.add(uuid);
        });
      }
    });

    // 각 메시지에서 모든 매치 추출
    const allMatches: Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }> = [];

    matchedUuids.forEach((uuid) => {
      const messageIndex = this.messageMap.get(uuid);
      if (messageIndex === undefined) return;

      const message = this.messages[messageIndex];
      if (!message) return;

      // 메시지 텍스트 추출
      const messageText =
        filterType === "toolId"
          ? extractToolIds(message)
          : extractSearchableText(message);

      // 메시지 내 모든 매치 개수 계산
      const matchCount = this.findAllMatchesInText(messageText, lowerQuery);

      // 각 매치마다 별도의 SearchMatch 생성
      for (let i = 0; i < matchCount; i++) {
        allMatches.push({
          messageUuid: uuid,
          messageIndex,
          matchIndex: i,
          matchCount,
        });
      }
    });

    // 완전 역순 정렬: 아래에서 위로 탐색 (최신 메시지의 마지막 매치부터)
    allMatches.sort((a, b) => {
      if (a.messageIndex !== b.messageIndex) {
        return b.messageIndex - a.messageIndex; // 최신 메시지 우선
      }
      return b.matchIndex - a.matchIndex; // 메시지 내에서도 마지막 매치부터
    });

    return allMatches;
  }

  // 인덱스 초기화
  clear(): void {
    this.contentIndex = createFlexSearchIndex();
    this.toolIdIndex = createFlexSearchIndex();
    this.messageMap.clear();
    this.messages = [];
    this.isBuilt = false;
  }
}

// 싱글톤 인스턴스
export const messageSearchIndex = new MessageSearchIndex();

// 편의 함수들
export const buildSearchIndex = (messages: ClaudeMessage[]): void => {
  messageSearchIndex.build(messages);
};

export const searchMessages = (
  query: string,
  filterType: SearchFilterType = "content"
): Array<{ messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number }> => {
  return messageSearchIndex.search(query, filterType);
};

export const clearSearchIndex = (): void => {
  messageSearchIndex.clear();
};
