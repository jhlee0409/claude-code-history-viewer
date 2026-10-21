import type { SessionTokenStats } from "@/types";
import { NO_VALUE } from "./locale";

/** Validate before formatting: empty dates must not become epoch or today's date. */
export function hasRecordedTime(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(new Date(value).getTime());
}

export function recordedTime(value: string, format: (value: string) => string, missing = NO_VALUE): string {
  return hasRecordedTime(value) ? format(value) : missing;
}

/** A zero-length session is data; a missing, invalid or reversed interval is not. */
export function recordedDuration(first: string, last: string, format: (minutes: number) => string, missing = NO_VALUE): string {
  if (!hasRecordedTime(first) || !hasRecordedTime(last)) return missing;
  const minutes = (new Date(last).getTime() - new Date(first).getTime()) / 60_000;
  return minutes >= 0 ? format(minutes) : missing;
}

/** This metadata qualifies the session aggregate, never individual counters/models. */
export function tokenRecordingNote(stats: SessionTokenStats) {
  switch (stats.token_usage_recording) {
    case "recorded": return null;
    case "absent": return "common.missingValue.notRecorded";
    case "partial": return "common.missingValue.partialTokens";
    default: return "common.missingValue.unknownTokens";
  }
}

export function recordedTokens(stats: SessionTokenStats, format: (value: number) => string, missing = NO_VALUE): string {
  return stats.token_usage_recording === "absent" ? missing : format(stats.total_tokens);
}
