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

// Scroll behavior constants
const SCROLL_RETRY_DELAY_MS = 50;
const SCROLL_INIT_DELAY_MS = 100;
const SCROLL_THROTTLE_MS = 100;
const SCROLL_THRESHOLD_PX = 100;
const MIN_MESSAGES_FOR_SCROLL_BUTTONS = 5;
const SCROLL_BOTTOM_TOLERANCE_PX = 5;
const MAX_SCROLL_RETRY_ATTEMPTS = 3;

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
  /** Whether the scroll element is ready (OverlayScrollbars initialized) */
  scrollElementReady?: boolean;
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
  scrollElementReady = false,
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
            if (element.scrollTop < element.scrollHeight - element.clientHeight - SCROLL_BOTTOM_TOLERANCE_PX) {
              element.scrollTop = element.scrollHeight;
            }
          }, SCROLL_RETRY_DELAY_MS);
        }, SCROLL_RETRY_DELAY_MS);
      }
      return;
    }

    // Fallback to DOM-based scrolling
    if (element) {
      // 여러 번 시도하여 확실히 맨 아래로 이동
      const attemptScroll = (attempts = 0) => {
        element.scrollTop = element.scrollHeight;
        if (
          attempts < MAX_SCROLL_RETRY_ATTEMPTS &&
          element.scrollTop < element.scrollHeight - element.clientHeight - SCROLL_BOTTOM_TOLERANCE_PX * 2
        ) {
          setTimeout(() => attemptScroll(attempts + 1), SCROLL_RETRY_DELAY_MS);
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

    // 스크롤 요소가 준비되지 않았으면 대기
    if (!scrollElementReady) {
      return;
    }

    // 메시지가 있고 로딩 완료되고 현재 세션에 대해 스크롤이 안된 상태일 때
    if (
      messagesLength > 0 &&
      !isLoading &&
      selectedSessionId &&
      scrollReadyForSessionId !== selectedSessionId
    ) {
      if (import.meta.env.DEV) {
        console.log(`[useScrollNavigation] Starting scroll for session ${selectedSessionId?.slice(-8)}, messages: ${messagesLength}`);
      }

      // 즉시 준비 완료 표시하여 UI 표시 (스크롤은 별도로 진행)
      setScrollReadyForSessionId(selectedSessionId);

      // RAF 2프레임 후 스크롤 (virtualizer 렌더링 대기)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom();
          // 스크롤 보정을 위한 짧은 지연 후 재시도
          scrollTimeoutRef.current = setTimeout(() => {
            scrollToBottom();
            if (import.meta.env.DEV) {
              console.log(`[useScrollNavigation] Scroll complete for session ${selectedSessionId?.slice(-8)}`);
            }
          }, 50);
        });
      });
    }

    // 클린업
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [messagesLength, isLoading, selectedSessionId, scrollReadyForSessionId, scrollToBottom, scrollElementReady]);

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
    // Store reference to avoid race condition in cleanup
    let scrollElementRef: HTMLElement | null = null;

    const handleScroll = () => {
      if (throttleTimer) return;

      throttleTimer = setTimeout(() => {
        try {
          const viewport = getScrollViewport();
          if (viewport) {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD_PX;
            const isNearTop = scrollTop < SCROLL_THRESHOLD_PX;
            setShowScrollToBottom(!isNearBottom && messagesLength > MIN_MESSAGES_FOR_SCROLL_BUTTONS);
            setShowScrollToTop(!isNearTop && messagesLength > MIN_MESSAGES_FOR_SCROLL_BUTTONS);
          }
        } catch (error) {
          console.error("Scroll handler error:", error);
        }
        throttleTimer = null;
      }, SCROLL_THROTTLE_MS);
    };

    // Delay to ensure OverlayScrollbars is initialized
    const timer = setTimeout(() => {
      scrollElementRef = getScrollViewport();
      if (scrollElementRef) {
        scrollElementRef.addEventListener("scroll", handleScroll, { passive: true });
        handleScroll();
      }
    }, SCROLL_INIT_DELAY_MS);

    return () => {
      clearTimeout(timer);
      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }
      // Use stored reference to avoid race condition
      if (scrollElementRef) {
        scrollElementRef.removeEventListener("scroll", handleScroll);
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
