/**
 * Claude Code's `cleanupPeriodDays` setting: how many days Claude Code keeps
 * session transcripts before it deletes them.
 *
 * The bounds mirror Claude Code's own validation — a whole number of days,
 * minimum 1, no upper limit. `0` fails that validation, and the official docs
 * recommend a large value such as 3650 for long retention, so capping the
 * input at a year blocked the documented setup (#587).
 */
export const DEFAULT_CLEANUP_PERIOD_DAYS = 30;
export const MIN_CLEANUP_PERIOD_DAYS = 1;

export function isValidCleanupPeriod(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_CLEANUP_PERIOD_DAYS
  );
}

/** A typed value as a valid period, or `undefined` when it isn't one. */
export function parseCleanupPeriodInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return isValidCleanupPeriod(value) ? value : undefined;
}
