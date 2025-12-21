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
            if (hasStringProperty(item, "text")) {
              parts.push(item.text as string);
            }
            if (hasStringProperty(item, "thinking")) {
              parts.push(item.thinking as string);
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
  private isBuilt = false;

  constructor() {
    this.contentIndex = createFlexSearchIndex();
    this.toolIdIndex = createFlexSearchIndex();
  }

  // 인덱스 구축 (메시지 로드 시 1회 호출)
  build(messages: ClaudeMessage[]): void {
    // 기존 인덱스 클리어
    this.clear();

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

  // 검색 실행
  search(
    query: string,
    filterType: SearchFilterType = "content"
  ): Array<{ messageUuid: string; messageIndex: number }> {
    if (!this.isBuilt || !query.trim()) {
      return [];
    }

    const lowerQuery = query.toLowerCase();
    const index = filterType === "toolId" ? this.toolIdIndex : this.contentIndex;

    // FlexSearch 검색
    const results = index.search(lowerQuery, {
      limit: 1000, // 최대 1000개 결과
      enrich: true, // 저장된 데이터 포함
    });

    // 결과 변환
    const matches: Array<{ messageUuid: string; messageIndex: number }> = [];
    const seenUuids = new Set<string>();

    results.forEach((fieldResult: { field: string; result: (string | EnrichedResult)[] }) => {
      if (fieldResult.result) {
        fieldResult.result.forEach((item: string | EnrichedResult) => {
          const uuid = extractUuidFromResult(item);
          if (!seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            const messageIndex = this.messageMap.get(uuid);
            if (messageIndex !== undefined) {
              matches.push({
                messageUuid: uuid,
                messageIndex,
              });
            }
          }
        });
      }
    });

    // messageIndex 기준 정렬
    matches.sort((a, b) => a.messageIndex - b.messageIndex);

    return matches;
  }

  // 인덱스 초기화
  clear(): void {
    this.contentIndex = createFlexSearchIndex();
    this.toolIdIndex = createFlexSearchIndex();
    this.messageMap.clear();
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
): Array<{ messageUuid: string; messageIndex: number }> => {
  return messageSearchIndex.search(query, filterType);
};

export const clearSearchIndex = (): void => {
  messageSearchIndex.clear();
};
