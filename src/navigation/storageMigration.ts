/**
 * One-time migration of the UI's stored state (plan T9b), run once before the
 * store reads anything (`useAppStore`).
 *
 * Version 2 (T9b):
 * - Token stats is no screen of its own any more but the analytics "tokens"
 *   sub-tab. `tabs.v1` places (tabs and their back/forward entries) on
 *   `tokenStats` move to `analytics` + `analyticsTab: "tokens"`, written as
 *   `tabs.v2`; `tabs.v1` is removed.
 * - The recent-edits dock is gone (the toolbar's Edits screen is the one
 *   recent-edits surface): its mode, open state, density and width keys are
 *   deleted. The page's row density becomes the Edits screen's.
 *
 * The version is recorded in `ui-storage.version`; a later start skips the
 * migration, so an older build writing `tabs.v1` again (two versions open
 * side by side) never replaces the newer tabs. Nothing else of the app's
 * storage (the recent list `library.recent.v1`, favourites, the inspector)
 * names a screen, and the command manifest has no token-stats command, so
 * there is nothing more to move.
 */
import { DEFAULT_ANALYTICS_TAB, isAnalyticsTab, type AnalyticsTab } from "./place";
import { TABS_STORAGE_KEY } from "./documents";

export const UI_STORAGE_VERSION_KEY = "ui-storage.version";
export const UI_STORAGE_VERSION = 2;

/** Where T8 stored the tabs (version 1). */
export const LEGACY_TABS_STORAGE_KEY = "tabs.v1";

/** The removed recent-edits dock's keys (its old slice and `App`'s resize width). */
export const REMOVED_DOCK_KEYS = [
  "recent-edits-mode",
  "recent-edits-dock-open",
  "recent-edits-density-dock",
  "recent-edits-width",
] as const;

/** The full page's row density, which the Edits screen keeps (`RECENT_EDITS_DENSITY_KEY`). */
const LEGACY_PAGE_DENSITY_KEY = "recent-edits-density-page";
export const RECENT_EDITS_DENSITY_KEY = "recent-edits-density";

type MigrationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A v1 place (`view`) as a v2 one (`view` + `analyticsTab`). */
function placeV2<T extends Record<string, unknown>>(entry: T): T & { analyticsTab: AnalyticsTab } {
  if (entry.view === "tokenStats") return { ...entry, view: "analytics", analyticsTab: "tokens" };
  return { ...entry, analyticsTab: isAnalyticsTab(entry.analyticsTab) ? entry.analyticsTab : DEFAULT_ANALYTICS_TAB };
}

function historyV2(history: unknown): unknown {
  if (!isObject(history)) return history;
  const list = (entries: unknown) =>
    Array.isArray(entries) ? entries.map((e) => (isObject(e) ? placeV2(e) : e)) : entries;
  return { ...history, back: list(history.back), forward: list(history.forward) };
}

/**
 * `tabs.v1` JSON as `tabs.v2` JSON. Anything that is not v1 tabs is returned
 * unchanged: stored under v2, reading it reports it as unreadable once, as a
 * damaged v1 store was reported before.
 */
export function migrateTabsV1(raw: string): string {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.documents)) return raw;
  return JSON.stringify({
    ...value,
    version: 2,
    documents: value.documents.map((doc) =>
      isObject(doc) ? { ...placeV2(doc), history: historyV2(doc.history) } : doc,
    ),
  });
}

function migrateToVersion2(storage: MigrationStorage): void {
  const legacyTabs = storage.getItem(LEGACY_TABS_STORAGE_KEY);
  if (legacyTabs != null) {
    // Tabs a newer build already wrote win over the old ones.
    if (storage.getItem(TABS_STORAGE_KEY) == null) {
      storage.setItem(TABS_STORAGE_KEY, migrateTabsV1(legacyTabs));
    }
    storage.removeItem(LEGACY_TABS_STORAGE_KEY);
  }

  const pageDensity = storage.getItem(LEGACY_PAGE_DENSITY_KEY);
  if (pageDensity != null) {
    if (storage.getItem(RECENT_EDITS_DENSITY_KEY) == null) {
      storage.setItem(RECENT_EDITS_DENSITY_KEY, pageDensity);
    }
    storage.removeItem(LEGACY_PAGE_DENSITY_KEY);
  }

  for (const key of REMOVED_DOCK_KEYS) {
    if (storage.getItem(key) != null) storage.removeItem(key);
  }
}

/** Bring stored UI state up to `UI_STORAGE_VERSION`, once. Never throws. */
export function runUiStorageMigrations(
  storage: MigrationStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    const stored = Number(storage.getItem(UI_STORAGE_VERSION_KEY) ?? "0");
    const version = Number.isFinite(stored) ? stored : 0;
    if (version >= UI_STORAGE_VERSION) return;
    migrateToVersion2(storage);
    storage.setItem(UI_STORAGE_VERSION_KEY, String(UI_STORAGE_VERSION));
  } catch {
    // Storage unavailable (private mode, quota): the app starts from its
    // defaults, as it does without stored state.
  }
}
