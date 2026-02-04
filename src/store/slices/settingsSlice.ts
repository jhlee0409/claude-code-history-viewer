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
  updateSettings: UpdateSettings;
  sessionSortOrder: SessionSortOrder;
}

export interface SettingsSliceActions {
  setExcludeSidechain: (exclude: boolean) => void;
  setShowSystemMessages: (show: boolean) => void;
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

const initialSettingsState: SettingsSliceState = {
  excludeSidechain: true,
  showSystemMessages: false,
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
    } catch (error) {
      console.warn("Failed to load update settings:", error);
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
