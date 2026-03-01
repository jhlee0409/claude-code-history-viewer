/**
 * Storage adapter — Tauri plugin-store in desktop mode, localStorage in web mode.
 *
 * Provides a unified interface so callers don't need to care about the runtime.
 *
 * Usage:
 *   import { storageAdapter } from "@/services/storage";
 *   const store = await storageAdapter.load("settings.json");
 *   await store.set("key", value);
 *   const val = await store.get("key");
 */

import { isTauri } from "@/utils/platform";

export interface StoreHandle {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

/**
 * Load (or create) a named store.
 *
 * In Tauri mode this delegates to `@tauri-apps/plugin-store`.
 * In web mode it uses `localStorage` with a namespace prefix.
 */
async function loadStore(
  name: string,
  _options?: { defaults?: Record<string, unknown>; autoSave?: boolean },
): Promise<StoreHandle> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const storeOpts = _options
      ? { defaults: _options.defaults ?? {}, autoSave: _options.autoSave }
      : undefined;
    const tauriStore = await load(name, storeOpts);
    return {
      get: <T = unknown>(key: string) => tauriStore.get(key) as Promise<T | null>,
      set: (key: string, value: unknown) => tauriStore.set(key, value),
      save: () => tauriStore.save(),
    };
  }

  // Web fallback — localStorage with namespace
  const prefix = `webui:${name}:`;
  return {
    get: <T = unknown>(key: string) => {
      try {
        const raw = localStorage.getItem(`${prefix}${key}`);
        return Promise.resolve(raw != null ? (JSON.parse(raw) as T) : null);
      } catch {
        return Promise.resolve(null);
      }
    },
    set: (key: string, value: unknown) => {
      try {
        localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
      } catch {
        // localStorage full or unavailable — silently ignore
      }
      return Promise.resolve();
    },
    save: () => Promise.resolve(), // no-op in web mode
  };
}

export const storageAdapter = { load: loadStore };
