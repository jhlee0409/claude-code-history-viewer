/**
 * Session source (entrypoint) helpers.
 *
 * Claude Code stamps every JSONL record with a top-level `entrypoint` field
 * identifying the originating client: "cli" / "claude-vscode" / "claude-desktop".
 * The backend stores that raw value on `ClaudeSession.entrypoint` untouched;
 * all normalization (raw value -> filter category, label, badge style) lives
 * here so unknown future values degrade gracefully instead of crashing.
 */

import type { SessionEntrypointFilter } from "@/types/metadata.types";

/** Normalized session source categories (the non-"all" filter values). */
export type EntrypointCategory = "cli" | "vscode" | "desktop";

/**
 * Map a raw JSONL `entrypoint` value to a normalized category.
 * Returns `null` for missing or unrecognized values — callers render those
 * as "no badge" and only "All" surfaces them in the filter.
 */
export function normalizeEntrypoint(
  raw: string | null | undefined
): EntrypointCategory | null {
  switch (raw) {
    case "cli":
      return "cli";
    case "claude-vscode":
      return "vscode";
    case "claude-desktop":
      return "desktop";
    default:
      return null;
  }
}

/** Whether a session's raw entrypoint passes the given source filter. */
export function matchesEntrypointFilter(
  raw: string | null | undefined,
  filter: SessionEntrypointFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  return normalizeEntrypoint(raw) === filter;
}

/** Presentation metadata for a normalized source category. */
export interface EntrypointBadgeMeta {
  /** i18n key for the short label (also used as the badge tooltip). */
  i18nKey: string;
  /** Tailwind classes for the badge pill. */
  badgeClass: string;
}

export const ENTRYPOINT_BADGE_META: Record<
  EntrypointCategory,
  EntrypointBadgeMeta
> = {
  cli: {
    i18nKey: "session.item.entrypoint.cli",
    badgeClass: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
  },
  vscode: {
    i18nKey: "session.item.entrypoint.vscode",
    badgeClass: "text-blue-600 bg-blue-500/10 dark:text-blue-400",
  },
  desktop: {
    i18nKey: "session.item.entrypoint.desktop",
    badgeClass: "text-purple-600 bg-purple-500/10 dark:text-purple-400",
  },
};

/** i18n key for each source-filter option (used by the segmented control). */
export const ENTRYPOINT_FILTER_LABEL_KEYS: Record<
  SessionEntrypointFilter,
  string
> = {
  all: "session.filter.source.all",
  cli: "session.filter.source.cli",
  vscode: "session.filter.source.vscode",
  desktop: "session.filter.source.desktop",
};

/** Selectable source-filter options, in display order. */
export const ENTRYPOINT_FILTER_OPTIONS: SessionEntrypointFilter[] = [
  "all",
  "cli",
  "vscode",
  "desktop",
];
