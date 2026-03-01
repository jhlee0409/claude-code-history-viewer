/**
 * Analytics Hook
 *
 * Orchestrates analytics sub-hooks into a single public API.
 * The UseAnalyticsReturn interface remains unchanged.
 */

import { useAppStore } from "../../store/useAppStore";
import type { UseAnalyticsReturn } from "../../types/analytics";
import { useAnalyticsNavigation } from "./useAnalyticsNavigation";
import { useAnalyticsAutoLoad } from "./useAnalyticsAutoLoad";
import { useAnalyticsComputed } from "./useAnalyticsComputed";

export const useAnalytics = (): UseAnalyticsReturn => {
  const analytics = useAppStore((s) => s.analytics);
  const actions = useAnalyticsNavigation();
  const computed = useAnalyticsComputed();

  // Side effects: auto-load on session/date-filter changes
  useAnalyticsAutoLoad(computed);

  return {
    state: analytics,
    actions,
    computed,
  };
};
