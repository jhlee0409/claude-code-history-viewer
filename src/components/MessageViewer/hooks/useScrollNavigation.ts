/**
 * useScrollNavigation Hook
 *
 * Manages scroll behavior and navigation in the message viewer.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { SCROLL_HIGHLIGHT_DELAY_MS } from "../types";

interface UseScrollNavigationOptions {
  scrollContainerRef: React.RefObject<OverlayScrollbarsComponentRef | null>;
  currentMatchUuid: string | null;
  currentMatchIndex: number;
  messagesLength: number;
  selectedSessionId?: string;
  isLoading: boolean;
}

interface UseScrollNavigationReturn {
  showScrollToTop: boolean;
  showScrollToBottom: boolean;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  getScrollViewport: () => HTMLElement | null;
}

export const useScrollNavigation = ({
  scrollContainerRef,
  currentMatchUuid,
  currentMatchIndex,
  messagesLength,
  selectedSessionId,
  isLoading,
}: UseScrollNavigationOptions): UseScrollNavigationReturn => {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const prevSessionIdRef = useRef<string | null>(null);

  // Helper to get the scroll viewport element
  const getScrollViewport = useCallback(() => {
    return scrollContainerRef.current?.osInstance()?.elements().viewport ?? null;
  }, [scrollContainerRef]);

  // 맨 아래로 스크롤하는 함수
  const scrollToBottom = useCallback(() => {
    const element = getScrollViewport();
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
  }, [getScrollViewport]);

  // 맨 위로 스크롤하는 함수
  const scrollToTop = useCallback(() => {
    const viewport = getScrollViewport();
    if (viewport) {
      viewport.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [getScrollViewport]);

  // 현재 매치된 하이라이트 텍스트로 스크롤 이동
  const scrollToHighlight = useCallback((matchUuid: string | null) => {
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
    if (matchUuid) {
      const messageElement = viewport.querySelector(
        `[data-message-uuid="${matchUuid}"]`
      );

      if (messageElement) {
        messageElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [getScrollViewport]);

  // 새로운 세션 선택 시 스크롤을 맨 아래로 이동 (채팅 스타일)
  useEffect(() => {
    // 세션이 실제로 변경되었고, 메시지가 로드된 경우에만 실행
    if (
      selectedSessionId &&
      prevSessionIdRef.current !== selectedSessionId &&
      messagesLength > 0 &&
      !isLoading
    ) {
      // 이전 세션 ID 업데이트
      prevSessionIdRef.current = selectedSessionId;

      // DOM이 완전히 업데이트된 후 스크롤 실행
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [selectedSessionId, messagesLength, isLoading, scrollToBottom]);

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
  };
};
