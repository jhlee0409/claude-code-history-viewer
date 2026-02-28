/**
 * Settings Slice
 *
 * Handles filter settings and update preferences.
 */

import { load } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import type { UpdateSettings } from "../../types/updateSettings";
import { DEFAULT_UPDATE_SETTINGS } from "../../types/updateSettings";
import type { SessionSortOrder } from "../../types/metadata.types";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

// ============================================================================
// State Interface
// ============================================================================

export interface SettingsSliceState {
  excludeSidechain: boolean;
  showSystemMessages: boolean;
  fontScale: number;
  highContrast: boolean;
  updateSettings: UpdateSettings;
  sessionSortOrder: SessionSortOrder;
}

export interface SettingsSliceActions {
  setExcludeSidechain: (exclude: boolean) => void;
  setShowSystemMessages: (show: boolean) => void;
  setFontScale: (scale: number) => Promise<void>;
  setHighContrast: (enabled: boolean) => Promise<void>;
  loadUpdateSettings: () => Promise<void>;
  setUpdateSetting: <K extends keyof UpdateSettings>(
    key: K,
    value: UpdateSettings[K]
  ) => Promise<void>;
  skipVersion: (version: string) => Promise<void>;
  postponeUpdate: () => Promise<void>;
  setSessionSortOrder: (order: SessionSortOrder) => Promise<void>;
}

export type SettingsSlice = SettingsSliceState & SettingsSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const DEFAULT_FONT_SCALE = 100;
const MIN_FONT_SCALE = 90;
const MAX_FONT_SCALE = 130;

const normalizeFontScale = (value: unknown): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_FONT_SCALE;
  }
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(value / 10) * 10));
};

const initialSettingsState: SettingsSliceState = {
  excludeSidechain: true,
  showSystemMessages: false,
  fontScale: DEFAULT_FONT_SCALE,
  highContrast: false,
  updateSettings: DEFAULT_UPDATE_SETTINGS,
  sessionSortOrder: "newest",
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createSettingsSlice: StateCreator<
  FullAppStore,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  ...initialSettingsState,

  setExcludeSidechain: (exclude: boolean) => {
    set({ excludeSidechain: exclude });
    // Refresh current project and session when filter changes
    const { selectedProject, selectedSession } = get();
    if (selectedProject) {
      get().selectProject(selectedProject);
    }
    if (selectedSession) {
      get().selectSession(selectedSession);
    }
  },

  setShowSystemMessages: (show: boolean) => {
    set({ showSystemMessages: show });
    // Refresh current session when filter changes
    const { selectedSession } = get();
    if (selectedSession) {
      get().selectSession(selectedSession);
    }
  },

  setFontScale: async (scale: number) => {
    const normalizedScale = normalizeFontScale(scale);
    set({ fontScale: normalizedScale });

    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {},
      });
      await store.set("fontScale", normalizedScale);
      await store.save();
    } catch (error) {
      // Intentionally non-blocking: font scale is already applied in-memory for current session.
      console.warn("Failed to save font scale:", error);
    }
  },

  setHighContrast: async (enabled: boolean) => {
    set({ highContrast: enabled });

    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {},
      });
      await store.set("highContrast", enabled);
      await store.save();
    } catch (error) {
      // Intentionally non-blocking: contrast mode is already applied in-memory for current session.
      console.warn("Failed to save high contrast setting:", error);
    }
  },

  loadUpdateSettings: async () => {
    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {},
      });
      const savedSettings = await store.get<UpdateSettings>("updateSettings");
      if (savedSettings) {
        set({
          updateSettings: { ...DEFAULT_UPDATE_SETTINGS, ...savedSettings },
        });
      }

      // Load session sort order
      const savedSortOrder = await store.get<SessionSortOrder>("sessionSortOrder");
      if (savedSortOrder) {
        set({ sessionSortOrder: savedSortOrder });
      }

      const savedFontScale = await store.get<number>("fontScale");
      const savedHighContrast = await store.get<boolean>("highContrast");
      set({
        fontScale: normalizeFontScale(savedFontScale),
        highContrast: savedHighContrast === true,
      });
    } catch (error) {
      console.warn("Failed to load persisted settings:", error);
    }
  },

  setUpdateSetting: async <K extends keyof UpdateSettings>(
    key: K,
    value: UpdateSettings[K]
  ) => {
    const { updateSettings } = get();
    const newSettings = { ...updateSettings, [key]: value };
    set({ updateSettings: newSettings });

    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {},
      });
      await store.set("updateSettings", newSettings);
      await store.save();
    } catch (error) {
      console.warn("Failed to save update settings:", error);
    }
  },

  skipVersion: async (version: string) => {
    const { updateSettings, setUpdateSetting } = get();
    if (!updateSettings.skippedVersions.includes(version)) {
      await setUpdateSetting("skippedVersions", [
        ...updateSettings.skippedVersions,
        version,
      ]);
    }
  },

  postponeUpdate: async () => {
    const { setUpdateSetting } = get();
    await setUpdateSetting("lastPostponedAt", Date.now());
  },

  setSessionSortOrder: async (order: SessionSortOrder) => {
    set({ sessionSortOrder: order });

    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {},
      });
      await store.set("sessionSortOrder", order);
      await store.save();
    } catch (error) {
      console.error("Failed to save session sort order:", error);
      toast.error("Failed to save session sort order");
    }
  },
});
