/**
 * useScrollNavigation Hook
 *
 * Manages scroll behavior and navigation in the message viewer.
 * Supports both DOM-based scrolling and virtualizer-based scrolling.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { SCROLL_HIGHLIGHT_DELAY_MS } from "../types";

interface UseScrollNavigationOptions {
  scrollContainerRef: React.RefObject<OverlayScrollbarsComponentRef | null>;
  currentMatchUuid: string | null;
  currentMatchIndex: number;
  messagesLength: number;
  selectedSessionId?: string;
  isLoading: boolean;
  /** Optional virtualizer instance for virtual scrolling */
  virtualizer?: Virtualizer<HTMLElement, Element> | null;
  /** Function to get scroll index for a UUID (handles group member resolution) */
  getScrollIndex?: (uuid: string) => number | null;
}

interface UseScrollNavigationReturn {
  showScrollToTop: boolean;
  showScrollToBottom: boolean;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getScrollViewport: () => HTMLElement | null;
  /** Session ID for which scroll is ready (compare with current session) */
  scrollReadyForSessionId: string | null;
}

export const useScrollNavigation = ({
  scrollContainerRef,
  currentMatchUuid,
  currentMatchIndex,
  messagesLength,
  selectedSessionId,
  isLoading,
  virtualizer,
  getScrollIndex,
}: UseScrollNavigationOptions): UseScrollNavigationReturn => {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  // 스크롤이 완료된 세션 ID (현재 세션과 비교하여 오버레이 표시 여부 결정)
  const [scrollReadyForSessionId, setScrollReadyForSessionId] = useState<string | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to get the scroll viewport element
  const getScrollViewport = useCallback(() => {
    return scrollContainerRef.current?.osInstance()?.elements().viewport ?? null;
  }, [scrollContainerRef]);

  // 맨 아래로 스크롤하는 함수
  const scrollToBottom = useCallback(() => {
    const element = getScrollViewport();

    // Use virtualizer if available
    if (virtualizer && messagesLength > 0) {
      // First, scroll to last index
      virtualizer.scrollToIndex(messagesLength - 1, { align: "end" });

      // Then, ensure we're truly at the bottom using DOM scroll
      // This compensates for height estimation inaccuracies
      if (element) {
        // Wait for virtualizer to render, then force scroll to absolute bottom
        setTimeout(() => {
          element.scrollTop = element.scrollHeight;
          // Retry if not at bottom (height estimation may cause slight offset)
          setTimeout(() => {
            if (element.scrollTop < element.scrollHeight - element.clientHeight - 5) {
              element.scrollTop = element.scrollHeight;
            }
          }, 50);
        }, 50);
      }
      return;
    }

    // Fallback to DOM-based scrolling
    if (element) {
      // 여러 번 시도하여 확실히 맨 아래로 이동
      const attemptScroll = (attempts = 0) => {
        element.scrollTop = element.scrollHeight;
        if (
          attempts < 3 &&
          element.scrollTop < element.scrollHeight - element.clientHeight - 10
        ) {
          setTimeout(() => attemptScroll(attempts + 1), 50);
        }
      };
      attemptScroll();
    }
  }, [getScrollViewport, virtualizer, messagesLength]);

  // 맨 위로 스크롤하는 함수
  const scrollToTop = useCallback(() => {
    // Use virtualizer if available
    if (virtualizer) {
      virtualizer.scrollToIndex(0, { align: "start" });
      return;
    }

    // Fallback to DOM-based scrolling
    const viewport = getScrollViewport();
    if (viewport) {
      viewport.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [getScrollViewport, virtualizer]);

  // 현재 매치된 하이라이트 텍스트로 스크롤 이동
  const scrollToHighlight = useCallback((matchUuid: string | null) => {
    if (!matchUuid) return;

    // Use virtualizer if available
    if (virtualizer && getScrollIndex) {
      const index = getScrollIndex(matchUuid);
      if (index !== null) {
        virtualizer.scrollToIndex(index, { align: "center" });
        // After virtualizer scrolls, try to find the highlight element
        setTimeout(() => {
          const viewport = getScrollViewport();
          if (!viewport) return;
          const highlightElement = viewport.querySelector(
            '[data-search-highlight="current"]'
          );
          if (highlightElement) {
            highlightElement.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }
        }, 100);
        return;
      }
    }

    // Fallback to DOM-based scrolling
    const viewport = getScrollViewport();
    if (!viewport) return;

    // 먼저 하이라이트된 텍스트 요소를 찾음
    const highlightElement = viewport.querySelector(
      '[data-search-highlight="current"]'
    );

    if (highlightElement) {
      // 하이라이트된 텍스트로 스크롤
      highlightElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    // 하이라이트 요소가 없으면 메시지 영역으로 스크롤 (fallback)
    const messageElement = viewport.querySelector(
      `[data-message-uuid="${matchUuid}"]`
    );

    if (messageElement) {
      messageElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [getScrollViewport, virtualizer, getScrollIndex]);

  // 메시지 로드 완료 후 스크롤 실행
  // scrollReadyForSessionId !== selectedSessionId 면 스크롤 필요
  useEffect(() => {
    // 이전 타이머 정리
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    // 메시지가 있고 로딩 완료되고 현재 세션에 대해 스크롤이 안된 상태일 때
    if (
      messagesLength > 0 &&
      !isLoading &&
      selectedSessionId &&
      scrollReadyForSessionId !== selectedSessionId
    ) {
      // 스크롤 실행 및 완료 대기
      requestAnimationFrame(() => {
        scrollToBottom();

        // 스크롤 완료 대기 후 해당 세션에 대해 준비 완료 표시
        scrollTimeoutRef.current = setTimeout(() => {
          scrollToBottom();

          scrollTimeoutRef.current = setTimeout(() => {
            // 현재 세션 ID를 준비 완료로 표시
            setScrollReadyForSessionId(selectedSessionId);
          }, 200);
        }, 200);
      });
    }

    // 클린업
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messagesLength, isLoading, selectedSessionId, scrollReadyForSessionId, scrollToBottom]);

  // 현재 매치 변경 시 해당 하이라이트로 스크롤
  useEffect(() => {
    if (currentMatchUuid) {
      // DOM 업데이트 후 스크롤 (렌더링 완료 대기)
      const timer = setTimeout(() => {
        scrollToHighlight(currentMatchUuid);
      }, SCROLL_HIGHLIGHT_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [currentMatchUuid, currentMatchIndex, scrollToHighlight]);

  // 스크롤 이벤트 최적화 (쓰로틀링 적용)
  useEffect(() => {
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (throttleTimer) return;

      throttleTimer = setTimeout(() => {
        try {
          const viewport = getScrollViewport();
          if (viewport) {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            const isNearTop = scrollTop < 100;
            setShowScrollToBottom(!isNearBottom && messagesLength > 5);
            setShowScrollToTop(!isNearTop && messagesLength > 5);
          }
        } catch (error) {
          console.error("Scroll handler error:", error);
        }
        throttleTimer = null;
      }, 100);
    };

    // Delay to ensure OverlayScrollbars is initialized
    const timer = setTimeout(() => {
      const scrollElement = getScrollViewport();
      if (scrollElement) {
        scrollElement.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }
      const scrollElement = getScrollViewport();
      if (scrollElement) {
        scrollElement.removeEventListener("scroll", handleScroll);
      }
    };
  }, [messagesLength, getScrollViewport]);

  return {
    showScrollToTop,
    showScrollToBottom,
    scrollToTop,
    scrollToBottom,
    getScrollViewport,
    scrollReadyForSessionId,
  };
};
