/**
 * View-level pending loads.
 *
 * Some loads live in component or hook state instead of the app store (the
 * Settings Manager's settings fetch, MCP server and preset lists, project
 * session lists). A component registers such a load while it is in flight
 * with `usePendingLoad(isLoading)`; `usePendingLoadCount()` reports how many
 * are registered. AppLayout folds the count into the root's non-visual
 * `data-ready` marker, so the marker never claims "ready" while a view still
 * shows its loader. Registration renders nothing and never affects layout.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";

let pendingCount = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getPendingLoadCount = (): number => pendingCount;

/** Register one pending load; the returned release is idempotent. */
export function beginPendingLoad(): () => void {
  pendingCount += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingCount -= 1;
    notify();
  };
}

/**
 * Keep one load registered while `active` is true. A layout effect, so the
 * registration is committed before the browser paints the loader.
 */
export function usePendingLoad(active: boolean): void {
  useLayoutEffect(() => (active ? beginPendingLoad() : undefined), [active]);
}

export function usePendingLoadCount(): number {
  return useSyncExternalStore(subscribe, getPendingLoadCount, getPendingLoadCount);
}
