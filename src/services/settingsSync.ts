/**
 * Settings shared by every desktop window (issue #656).
 *
 * Each window runs its own page and store, so what one window changes must
 * reach the others:
 *
 * - **Preferences in `settings.json`** (theme, language, text size, sort
 *   order...) are saved through `saveSetting`, which then announces the change
 *   (`settings-changed`, naming the window it came from). Every other window
 *   applies it in memory (`listenForSettingChanges`) and never saves it again,
 *   so a change does not echo back and forth.
 * - **User metadata** (`user-data.json`: names, favourites, hidden projects,
 *   grouping, custom folders) is saved by the backend, which announces each
 *   save to every window in the order the saves were made
 *   (`user-metadata-changed`, `listenForUserMetadataChanges`).
 *
 * Layout state kept in `localStorage` (panel widths, the minimap...) is not
 * announced: each window keeps its own while open, and a new window starts
 * from what was stored last. The WebUI is one window per browser tab, as
 * before: nothing is announced or heard there.
 */
/*
 * `@tauri-apps/api/event` is imported where it is used, as everywhere in the
 * app: the WebUI runs without the Tauri runtime and never loads it.
 */
import { storageAdapter } from "@/services/storage";
import type { UserMetadata } from "@/types";
import { currentWindowLabel, isTauri } from "@/utils/platform";

/** A preference saved in one window (`saveSetting`). */
export const SETTINGS_CHANGED_EVENT = "settings-changed";

/** User metadata saved (`USER_METADATA_CHANGED_EVENT` in `commands/metadata.rs`). */
export const USER_METADATA_CHANGED_EVENT = "user-metadata-changed";

/** What `settings-changed` carries. */
export interface SettingChange {
  key: string;
  value: unknown;
  /** The window that saved it. */
  origin: string;
}

const SETTINGS_FILE = "settings.json";

/**
 * Save preference `key` to `settings.json` and tell the other windows. Rejects
 * when the save fails; a change saved but not announced is logged (the other
 * windows read it when they next start).
 */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const store = await storageAdapter.load(SETTINGS_FILE, { autoSave: false, defaults: {} });
  await store.set(key, value);
  await store.save();
  if (!isTauri()) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    const change: SettingChange = { key, value, origin: currentWindowLabel() };
    await emit(SETTINGS_CHANGED_EVENT, change);
  } catch (error) {
    console.error(`Setting "${key}" saved but not announced to the other windows:`, error);
  }
}

/**
 * Listen for `event` in the desktop app (a no-op elsewhere); returns the
 * stop function, which also cancels a listener still attaching.
 */
function listenDesktop<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<T>(event, (message) => handler(message.payload)))
    .then(
      (stop) => {
        if (stopped) stop();
        else unlisten = stop;
      },
      (error: unknown) => {
        console.error(`Not listening for ${event}:`, error);
      },
    );
  return () => {
    stopped = true;
    unlisten?.();
  };
}

/** Apply each preference another window saved; returns the stop function. */
export function listenForSettingChanges(apply: (key: string, value: unknown) => void): () => void {
  const self = currentWindowLabel();
  return listenDesktop<SettingChange>(SETTINGS_CHANGED_EVENT, (change) => {
    if (change.origin === self) return;
    apply(change.key, change.value);
  });
}

/** Apply each user-metadata save (from any window); returns the stop function. */
export function listenForUserMetadataChanges(apply: (metadata: UserMetadata) => void): () => void {
  return listenDesktop<UserMetadata>(USER_METADATA_CHANGED_EVENT, apply);
}
