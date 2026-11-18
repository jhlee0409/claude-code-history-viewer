import type { Theme } from "@/contexts/theme/context";
import { storageAdapter } from "@/services/storage";

export const loadThemeFromTauriStore = async () => {
  try {
    const store = await storageAdapter.load("settings.json", { defaults: {}, autoSave: false });
    return (await store.get("theme")) as Theme | null;
  } catch (error) {
    console.error("Failed to load theme:", error);
    throw error;
  }
};

export const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark" || value === "system";
