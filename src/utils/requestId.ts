/**
 * HMR-safe request ID counters for async race condition guards.
 *
 * In dev mode (Vite HMR), counters persist across hot module reloads
 * so in-flight requests are correctly invalidated after code changes.
 * In production, uses a plain module-level object.
 */
const counters: Record<string, number> = (() => {
  const hotData = import.meta.hot?.data as Record<string, unknown> | undefined;
  if (hotData) {
    if (!hotData._requestIdCounters) {
      hotData._requestIdCounters = {};
    }
    return hotData._requestIdCounters as Record<string, number>;
  }
  return {};
})();

/** Increment and return the next request ID for the given key. */
export function nextRequestId(key: string): number {
  counters[key] = (counters[key] ?? 0) + 1;
  return counters[key];
}

/** Get the current (latest) request ID for the given key. */
export function getRequestId(key: string): number {
  return counters[key] ?? 0;
}
