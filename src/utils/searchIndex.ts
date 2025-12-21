import FlexSearch from "flexsearch";
import type { ClaudeMessage } from "../types";
import type { SearchFilterType } from "../store/useAppStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlexSearchDocumentIndex = any;

// 검색 가능한 텍스트 추출 (content 검색용)
const extractSearchableText = (message: ClaudeMessage): string => {
  const parts: string[] = [];

  // content 추출
  if (message.content) {
    if (typeof message.content === "string") {
      parts.push(message.content);
    } else if (Array.isArray(message.content)) {
      message.content.forEach((item) => {
        if (typeof item === "string") {
          parts.push(item);
        } else if (item && typeof item === "object") {
          if ("text" in item && typeof item.text === "string") {
            parts.push(item.text);
          }
          if ("thinking" in item && typeof item.thinking === "string") {
            parts.push(item.thinking);
          }
        }
      });
    }
  }

  // toolUse name 추출
  if (message.toolUse && typeof message.toolUse === "object") {
    const toolName = (message.toolUse as { name?: string }).name;
    if (toolName) {
      parts.push(toolName);
    }
  }

  // toolUseResult 추출
  if (message.toolUseResult) {
    const result = message.toolUseResult;
    if (typeof result === "object" && result !== null) {
      if ("stdout" in result && typeof result.stdout === "string") {
        parts.push(result.stdout);
      }
      if ("stderr" in result && typeof result.stderr === "string") {
        parts.push(result.stderr);
      }
      if ("content" in result && typeof result.content === "string") {
        parts.push(result.content);
      }
    } else if (typeof result === "string") {
      parts.push(result);
    }
  }

  return parts.join(" ");
};

// Tool ID 추출 (tool_use_id, tool_use.id 검색용)
const extractToolIds = (message: ClaudeMessage): string => {
  const ids: string[] = [];

  // message.content 배열에서 tool_use와 tool_result의 id 추출
  if (message.content && Array.isArray(message.content)) {
    message.content.forEach((item) => {
      if (item && typeof item === "object") {
        // tool_use의 id
        if ("type" in item && item.type === "tool_use" && "id" in item) {
          ids.push(String(item.id));
        }
        // tool_result의 tool_use_id
        if ("type" in item && item.type === "tool_result" && "tool_use_id" in item) {
          ids.push(String(item.tool_use_id));
        }
      }
    });
  }

  // toolUse 객체의 id
  if (message.toolUse && typeof message.toolUse === "object") {
    const toolUse = message.toolUse as { id?: string };
    if (toolUse.id) {
      ids.push(toolUse.id);
    }
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
