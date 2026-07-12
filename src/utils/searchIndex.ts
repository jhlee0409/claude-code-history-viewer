import FlexSearch from "flexsearch";
import type { Document as FlexSearchDocument } from "flexsearch";
import type { ClaudeMessage } from "../types";
import type { SearchFilterType } from "../store/useAppStore";

// FlexSearch document shape used by this module's content / toolId indexes
type SearchDoc = { uuid: string; messageIndex: number; text: string };
type FlexSearchDocumentIndex = FlexSearchDocument<SearchDoc>;

// Type guards for safe type checking
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hasStringProperty = (obj: Record<string, unknown>, key: string): boolean => {
  return key in obj && typeof obj[key] === "string";
};

// 검색 가능한 텍스트 추출 (content 검색용)
const MAX_TEXT_LENGTH = 10000; // 최대 10KB만 인덱싱 (텍스트용)
const MAX_INPUT_LENGTH = 5000; // tool_use.input 값 인덱싱 상한 (도구당)

// tool_use.input(객체)의 문자열/숫자 값을 재귀적으로 수집한다.
// 키가 아니라 값만 인덱싱해 글로벌(rust) 검색과 동작을 맞추고,
// budget으로 총 길이를 제한해 거대한 input이 인덱스를 부풀리지 않게 한다. (#429)
const collectInputValues = (
  value: unknown,
  parts: string[],
  budget: { remaining: number },
): void => {
  if (budget.remaining <= 0) return;
  if (typeof value === "string") {
    const s = value.slice(0, budget.remaining);
    parts.push(s);
    budget.remaining -= s.length;
  } else if (typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    budget.remaining -= String(value).length;
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (budget.remaining <= 0) break;
      collectInputValues(v, parts, budget);
    }
  } else if (isRecord(value)) {
    for (const v of Object.values(value)) {
      if (budget.remaining <= 0) break;
      collectInputValues(v, parts, budget);
    }
  }
};

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

            // Skip image content (base64 data is not searchable)
            if (itemType === "image") {
              continue;
            }

            // text content (길이 제한)
            if (hasStringProperty(item, "text")) {
              parts.push((item.text as string).slice(0, MAX_TEXT_LENGTH));
            }
            // thinking content (길이 제한)
            if (hasStringProperty(item, "thinking")) {
              parts.push((item.thinking as string).slice(0, MAX_TEXT_LENGTH));
            }
            // tool_use: name + input values (file_path, command, query 등) (#429)
            if (itemType === "tool_use") {
              if (hasStringProperty(item, "name")) parts.push(item.name as string);
              if (isRecord(item.input)) collectInputValues(item.input, parts, { remaining: MAX_INPUT_LENGTH });
            }
            // tool_result: content
            if (itemType === "tool_result" && hasStringProperty(item, "content")) {
              parts.push(item.content as string);
            }
            // server_tool_use: name + input values (#429)
            if (itemType === "server_tool_use") {
              if (hasStringProperty(item, "name")) parts.push(item.name as string);
              if (isRecord(item.input)) collectInputValues(item.input, parts, { remaining: MAX_INPUT_LENGTH });
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
            // mcp_tool_use: server_name, tool_name + input values (#429)
            if (itemType === "mcp_tool_use") {
              if (hasStringProperty(item, "server_name")) parts.push(item.server_name as string);
              if (hasStringProperty(item, "tool_name")) parts.push(item.tool_name as string);
              if (isRecord(item.input)) collectInputValues(item.input, parts, { remaining: MAX_INPUT_LENGTH });
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
    if (
      message.type === "assistant" &&
      isRecord(message.toolUse) &&
      hasStringProperty(message.toolUse, "name")
    ) {
      parts.push(message.toolUse.name as string);
    }

    // toolUseResult 추출 (큰 내용은 처음 부분만 인덱싱)
    const MAX_CONTENT_LENGTH = 5000; // 최대 5KB만 인덱싱
    if (
      (message.type === "user" || message.type === "assistant") &&
      message.toolUseResult
    ) {
      const result = message.toolUseResult;
      if (typeof result === "string") {
        parts.push(result.slice(0, MAX_CONTENT_LENGTH));
      } else if (isRecord(result)) {
        if (hasStringProperty(result, "stdout")) {
          parts.push((result.stdout as string).slice(0, MAX_CONTENT_LENGTH));
        }
        if (hasStringProperty(result, "stderr")) {
          parts.push((result.stderr as string).slice(0, MAX_CONTENT_LENGTH));
        }
        if (hasStringProperty(result, "content")) {
          parts.push((result.content as string).slice(0, MAX_CONTENT_LENGTH));
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
    if (
      message.type === "assistant" &&
      isRecord(message.toolUse) &&
      hasStringProperty(message.toolUse, "id")
    ) {
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
//
// Tokenize mode: "forward" (prefix-only indexing).
//
// Why not "full":
//   "full" creates every substring of every word (O(n²) tokens), which
//   pegs the CPU at 100% for large sessions (47k+ messages, ~20s freeze).
//   "forward" creates only prefix substrings (O(n) tokens), keeping index
//   construction well under a second even for our largest sessions.
//
// Tradeoff — recall gap:
//   forward tokenize only matches queries that appear at a word boundary.
//   Searching for "bug" will NOT match "debugging" (no token starts with "bug").
//   With "full", it would.  For chat history search this is an acceptable
//   tradeoff — the common case (whole-word / prefix search) is fast and
//   accurate, and the linear fallback (linearSearchMessages) provides full
//   substring recall during the brief window before the index is ready.
const createFlexSearchIndex = (): FlexSearchDocumentIndex => {
  return new FlexSearch.Document({
    tokenize: "forward",
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

  // 인덱스가 구축 완료되었는지 확인
  isReady(): boolean {
    return this.isBuilt;
  }

  // 인덱스 구축 (메시지 로드 시 1회 호출) - 청크 단위 비동기 처리
  build(messages: ClaudeMessage[]): void {
    // Skip if already built with same messages or currently building
    if (this.messages === messages && (this.isBuilt || this.messages.length > 0)) {
      return;
    }

    // 기존 인덱스 클리어
    this.clear();

    // 메시지 원본 저장
    this.messages = messages;

    // 청크 단위로 비동기 인덱싱 시작
    this.buildAsync(messages);
  }

  // 비동기 청크 인덱싱 (메인 스레드 차단 방지)
  private buildAsync(messages: ClaudeMessage[]): void {
    const CHUNK_SIZE = 50; // 한 번에 처리할 메시지 수 (forward tokenize 기준 ~10ms/chunk)
    const YIELD_INTERVAL_MS = 50; // chunk 간 최소 대기 시간 (UI 반응성 확보)
    let currentIndex = 0;

    const processChunk = (deadline?: IdleDeadline) => {
      const timeLimit = deadline ? () => deadline.timeRemaining() > 2 : () => true;
      const endIndex = Math.min(currentIndex + CHUNK_SIZE, messages.length);

      for (let i = currentIndex; i < endIndex && timeLimit(); i++) {
        const message = messages[i];
        if (!message) continue;

        // Content 인덱스
        const text = extractSearchableText(message);
        if (text.trim()) {
          this.contentIndex.add({
            uuid: message.uuid,
            messageIndex: i,
            text: text.toLowerCase(),
          });
        }

        // Tool ID 인덱스
        const toolIds = extractToolIds(message);
        if (toolIds.trim()) {
          this.toolIdIndex.add({
            uuid: message.uuid,
            messageIndex: i,
            text: toolIds.toLowerCase(),
          });
        }

        this.messageMap.set(message.uuid, i);
        currentIndex = i + 1;
      }

      if (currentIndex < messages.length) {
        // 다음 청크를 idle callback으로 예약 (UI 반응성 우선)
        if ("requestIdleCallback" in window) {
          (window as Window & { requestIdleCallback: (cb: IdleRequestCallback, opts?: { timeout: number }) => number }).requestIdleCallback(processChunk, { timeout: 2000 });
        } else {
          setTimeout(processChunk, YIELD_INTERVAL_MS);
        }
      } else {
        // 완료
        this.isBuilt = true;
        if (import.meta.env.DEV) {
          console.log(`[SearchIndex] Built index for ${messages.length} messages`);
        }
      }
    };

    // 첫 청크를 idle callback으로 시작
    if ("requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (cb: IdleRequestCallback, opts?: { timeout: number }) => number }).requestIdleCallback(processChunk, { timeout: 2000 });
    } else {
      setTimeout(processChunk, YIELD_INTERVAL_MS);
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
    // FlexSearch's enriched result type is complex; cast to the shape we actually consume.
    const enrichedResults = results as unknown as Array<{ field: string; result: (string | EnrichedResult)[] }>;
    enrichedResults.forEach((fieldResult) => {
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
      return b.messageIndex - a.messageIndex; // newest messages first
    }
    return b.matchIndex - a.matchIndex; // last match within a message first
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

// 싱글톤 인스턴스 (kept as fallback for non-worker environments)
export const messageSearchIndex = new MessageSearchIndex();

// ============================================================================
// Web Worker-based Search Index
// ============================================================================

type SearchResult = { messageUuid: string; messageIndex: number; matchIndex: number; matchCount: number };

let worker: Worker | null = null;
let workerReady = false;
// In-flight build guard: prevents repeated index rebuilds when the user
// types continuously. Same messages reference is a no-op while a build
// is in flight or already ready.
let workerBuildInFlight = false;
let lastBuildMessagesRef: ClaudeMessage[] | null = null;
const pendingSearchCallbacks = new Map<number, (results: SearchResult[]) => void>();
const pendingSearchTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
const SEARCH_TIMEOUT_MS = 5000;
let searchIdCounter = 0;

// Internal: clear a pending search (cancel its timeout + delete its callback).
function resolveAndCleanupSearch(id: number, results: SearchResult[]): void {
  const callback = pendingSearchCallbacks.get(id);
  if (!callback) return;
  pendingSearchCallbacks.delete(id);
  const timer = pendingSearchTimeouts.get(id);
  if (timer != null) {
    clearTimeout(timer);
    pendingSearchTimeouts.delete(id);
  }
  callback(results);
}

// Internal: resolve every pending search with [] - used when the worker
// errors out or is cleared, so callbacks don't leak and the UI is unstuck.
function resolveAllPendingSearches(): void {
  const ids = Array.from(pendingSearchCallbacks.keys());
  for (const id of ids) {
    resolveAndCleanupSearch(id, []);
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./searchWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "build-complete") {
        workerReady = true;
        workerBuildInFlight = false;
        if (import.meta.env.DEV) {
          console.log(`[SearchIndex Worker] Index built for ${msg.count} messages`);
        }
      } else if (msg.type === "search-result") {
        resolveAndCleanupSearch(msg.id, msg.results);
      }
    };
    // Resolve all pending searches on worker crash/error so the UI never
    // gets stuck in a "searching..." state.
    worker.onerror = (event) => {
      if (import.meta.env.DEV) {
        console.error("[SearchIndex Worker] Worker error:", event);
      }
      workerReady = false;
      workerBuildInFlight = false;
      resolveAllPendingSearches();
    };
    return worker;
  } catch {
    // Worker creation failed (e.g., in test environment)
    return null;
  }
}

// 편의 함수들
export const buildSearchIndex = (messages: ClaudeMessage[]): void => {
  const w = getWorker();
  if (w) {
    // De-dup: skip if the same messages reference is already building or built.
    if (lastBuildMessagesRef === messages && (workerBuildInFlight || workerReady)) {
      return;
    }
    workerReady = false;
    workerBuildInFlight = true;
    lastBuildMessagesRef = messages;
    // Send minimal message data to worker (avoid transferring unnecessary fields)
    const minimalMessages = messages.map(m => ({
      uuid: m.uuid,
      type: m.type,
      content: m.content,
      toolUse: (m as unknown as Record<string, unknown>).toolUse,
      toolUseResult: (m as unknown as Record<string, unknown>).toolUseResult,
    }));
    w.postMessage({ type: "build", messages: minimalMessages });
  } else {
    // Fallback to main thread (shouldn't happen in browser)
    messageSearchIndex.build(messages);
  }
};

export const searchMessagesAsync = (
  query: string,
  filterType: SearchFilterType = "content"
): Promise<SearchResult[]> => {
  const w = getWorker();
  if (w && workerReady) {
    return new Promise((resolve) => {
      const id = ++searchIdCounter;
      pendingSearchCallbacks.set(id, resolve);
      // 5s safety timeout so the promise never stays pending if the worker
      // drops the message or the search hangs.
      const timer = setTimeout(() => {
        if (import.meta.env.DEV) {
          console.warn(`[SearchIndex Worker] Search ${id} timed out after ${SEARCH_TIMEOUT_MS}ms`);
        }
        resolveAndCleanupSearch(id, []);
      }, SEARCH_TIMEOUT_MS);
      pendingSearchTimeouts.set(id, timer);
      w.postMessage({ type: "search", id, query, filterType });
    });
  }
  // Worker not ready — resolve immediately with empty (caller uses linear fallback)
  return Promise.resolve([]);
};

export const searchMessages = (
  query: string,
  filterType: SearchFilterType = "content"
): SearchResult[] => {
  // Synchronous search: only works if main-thread index is built (legacy fallback)
  return messageSearchIndex.search(query, filterType);
};

export const clearSearchIndex = (): void => {
  messageSearchIndex.clear();
  workerReady = false;
  workerBuildInFlight = false;
  lastBuildMessagesRef = null;
  // Also resolve pending searches so callbacks don't linger past the clear.
  resolveAllPendingSearches();
  // Only send clear to worker if it already exists — avoids eagerly
  // spinning up the worker on every selectSession.
  if (worker) {
    worker.postMessage({ type: "clear" });
  }
};

export const isSearchIndexReady = (): boolean => {
  return workerReady || messageSearchIndex.isReady();
};

/**
 * Linear search fallback — scans all messages with String.includes.
 * Used when FlexSearch index is not yet built (pre-index stage).
 *
 * Returns results in newest-first order (descending messageIndex, then
 * descending matchIndex), matching the FlexSearch path so navigation is
 * consistent regardless of which code path is active.
 *
 * Performance: O(n) single pass, typically 50-200ms for 50k messages.
 * Recall: substring match (indexOf) — finds queries even mid-word, which
 * means the first search after session load may return more results than
 * subsequent searches through the FlexSearch "forward" index.  This gap
 * is a conscious tradeoff; see createFlexSearchIndex above.
 */
export const linearSearchMessages = (
  messages: ClaudeMessage[],
  query: string,
  filterType: SearchFilterType = "content"
): SearchResult[] => {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase();

  const results: SearchResult[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message) continue;

    const text = filterType === "toolId"
      ? extractToolIds(message)
      : extractSearchableText(message);

    if (!text) continue;
    const lowerText = text.toLowerCase();

    // Count all occurrences
    let count = 0;
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      count++;
      pos += lowerQuery.length;
    }

    if (count > 0) {
      for (let matchIdx = 0; matchIdx < count; matchIdx++) {
        results.push({
          messageUuid: message.uuid,
          messageIndex: i,
          matchIndex: matchIdx,
          matchCount: count,
        });
      }
    }
  }

  // Sort newest-first to match FlexSearch result order for consistent navigation
  results.sort((a, b) => b.messageIndex - a.messageIndex || b.matchIndex - a.matchIndex);

  return results;
};
