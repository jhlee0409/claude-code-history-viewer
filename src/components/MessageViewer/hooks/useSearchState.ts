/**
 * useSearchState Hook
 *
 * Manages search input state with deferred updates for performance.
 */

import { useState, useEffect, useCallback, useDeferredValue } from "react";
import { SEARCH_MIN_CHARS } from "../types";

interface UseSearchStateOptions {
  onSearchChange: (query: string) => void;
  sessionId?: string;
}

interface UseSearchStateReturn {
  searchQuery: string;
  deferredSearchQuery: string;
  isSearchPending: boolean;
  handleSearchInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleClearSearch: () => void;
  setSearchQuery: (query: string) => void;
}

export const useSearchState = ({
  onSearchChange,
  sessionId,
}: UseSearchStateOptions): UseSearchStateReturn => {
  // Optimistic UI: 입력 상태를 별도로 관리
  const [searchQuery, setSearchQuery] = useState("");

  // useDeferredValue: 검색은 백그라운드에서 처리
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // 검색 진행 중 여부 (시각적 피드백용)
  const isSearchPending = searchQuery !== deferredSearchQuery;

  // 입력 핸들러: controlled input으로 상태 업데이트
  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  // deferred 값이 변경될 때만 검색 실행
  useEffect(() => {
    // 빈 문자열이면 검색 초기화
    if (deferredSearchQuery.length === 0) {
      onSearchChange("");
      return;
    }

    // 최소 글자 수 미만이면 검색하지 않음
    if (deferredSearchQuery.length < SEARCH_MIN_CHARS) {
      return;
    }

    // 최소 글자 수 이상일 때만 검색 실행
    onSearchChange(deferredSearchQuery);
  }, [deferredSearchQuery, onSearchChange]);

  // 세션 변경 시 검색어 초기화
  useEffect(() => {
    setSearchQuery("");
  }, [sessionId]);

  // 검색어 초기화 핸들러
  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return {
    searchQuery,
    deferredSearchQuery,
    isSearchPending,
    handleSearchInput,
    handleClearSearch,
    setSearchQuery,
  };
};
