/**
 * Pagination Hook
 *
 * Reusable hook for paginated data loading.
 * Provides consistent pagination behavior across the application.
 */

import { useCallback, useMemo } from "react";
import {
  type BasePaginationState,
  canLoadMore,
  getNextOffset,
} from "../utils/pagination";

// ============================================================================
// Types
// ============================================================================

export interface UsePaginationOptions<T> {
  /** Current pagination state */
  pagination: BasePaginationState;
  /** Current items */
  items: T[];
  /** Function to load more items */
  loadMore: () => Promise<void>;
  /** Optional: reset function */
  reset?: () => void;
}

export interface UsePaginationReturn<T> {
  /** Current items */
  items: T[];
  /** Whether more items can be loaded */
  canLoadMore: boolean;
  /** Whether currently loading more items */
  isLoadingMore: boolean;
  /** Total items loaded so far */
  loadedCount: number;
  /** Next offset for loading */
  nextOffset: number;
  /** Load more items */
  loadMore: () => Promise<void>;
  /** Reset to initial state */
  reset?: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing paginated data
 *
 * @example
 * ```tsx
 * const { items, canLoadMore, isLoadingMore, loadMore } = usePagination({
 *   pagination: projectTokenStatsPagination,
 *   items: projectTokenStats,
 *   loadMore: () => loadMoreProjectTokenStats(projectPath),
 * });
 *
 * return (
 *   <div>
 *     {items.map(item => <Item key={item.id} {...item} />)}
 *     {canLoadMore && (
 *       <button onClick={loadMore} disabled={isLoadingMore}>
 *         {isLoadingMore ? 'Loading...' : 'Load More'}
 *       </button>
 *     )}
 *   </div>
 * );
 * ```
 */
export function usePagination<T>({
  pagination,
  items,
  loadMore: loadMoreFn,
  reset,
}: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const canLoad = useMemo(() => canLoadMore(pagination), [pagination]);

  const nextOffset = useMemo(() => getNextOffset(pagination), [pagination]);

  const loadMore = useCallback(async () => {
    if (!canLoad) return;
    await loadMoreFn();
  }, [canLoad, loadMoreFn]);

  return {
    items,
    canLoadMore: canLoad,
    isLoadingMore: pagination.isLoadingMore,
    loadedCount: items.length,
    nextOffset,
    loadMore,
    reset,
  };
}

export default usePagination;
