/**
 * The open session's token totals for the inspector's Tokens and Info tabs.
 *
 * Reads them through `selectSessionTokenStats` (owned by the session file,
 * `navigation/screenOwner.ts`), so another session's - or another tab's -
 * totals never show. When the open session has no answer yet (no totals
 * of its own, even empty ones), no load is running and its own load has
 * not failed, it asks for them once; a
 * failure is recorded with the session and stays until the user retries
 * (`retry`) or the session loads again elsewhere, so a failing backend is
 * not asked in a loop.
 */
import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { selectSessionTokenStats, type SessionTokenStatsView } from "@/navigation/screenOwner";

export interface UseSessionTokenStats extends SessionTokenStatsView {
  retry: () => void;
}

export function useSessionTokenStats(): UseSessionTokenStats {
  const view = useAppStore(useShallow(selectSessionTokenStats));
  const sessionPath = useAppStore((s) => s.selectedSession?.file_path ?? null);
  // Any token load in flight (the counter is shared with the project's
  // pages): wait for it rather than start a second request beside it.
  const isAnyTokenLoadRunning = useAppStore((s) => s.isLoadingTokenStats);
  const loadSessionTokenStats = useAppStore((s) => s.loadSessionTokenStats);

  // `view.isLoading`: this session has no answer of its own yet - neither
  // totals it owns nor its own failure. Keyed on the answer, not on the
  // totals being non-null: an answer of nothing would otherwise be asked
  // for again on every commit, an unbounded load loop.
  const needsLoad = sessionPath !== null && view.isLoading && !isAnyTokenLoadRunning;

  useEffect(() => {
    if (!needsLoad || sessionPath === null) return;
    void loadSessionTokenStats(sessionPath);
  }, [needsLoad, sessionPath, loadSessionTokenStats]);

  const retry = useCallback(() => {
    if (sessionPath !== null) void loadSessionTokenStats(sessionPath);
  }, [sessionPath, loadSessionTokenStats]);

  return { ...view, retry };
}
