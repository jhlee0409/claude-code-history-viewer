import { create } from "zustand";
import { toast } from "sonner";
import { storageAdapter } from "@/services/storage";
import { isTauri } from "@/utils/platform";
import i18n from "../i18n";
import type { SupportedLanguage } from "../i18n";
import { toSupportedLanguage as getSupportedLanguage } from "../i18n/documentLanguage";

interface LanguageStore {
  language: SupportedLanguage;
  isLoading: boolean;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

const getCurrentLanguage = (): SupportedLanguage => {
  const storedLang = localStorage.getItem("i18nextLng");
  if (storedLang) {
    return getSupportedLanguage(storedLang);
  }
  return getSupportedLanguage(i18n.language || "en");
};

export const useLanguageStore = create<LanguageStore>((set, get) => ({
  language: getCurrentLanguage(),
  isLoading: true,

  setLanguage: async (language) => {
    await i18n.changeLanguage(language);
    set({ language });

    try {
      const store = await storageAdapter.load("settings.json", { defaults: {}, autoSave: true });
      await store.set("language", language);
      await store.save();
    } catch {
      toast.error(i18n.t("common.settings.language.saveFailed"));
    }
  },

  loadLanguage: async () => {
    set({ isLoading: true });
    try {
      let language: SupportedLanguage | null = null;

      const i18nextLang = localStorage.getItem("i18nextLng");
      if (i18nextLang) {
        language = getSupportedLanguage(i18nextLang);
      }

      if (!language) {
        try {
          const store = await storageAdapter.load("settings.json", { defaults: {}, autoSave: true });
          language = (await store.get("language")) as SupportedLanguage | null;
        } catch (e) {
          console.log("Store not available:", e);
        }
      }

      if (language) {
        await i18n.changeLanguage(language);
        set({ language });
      } else {
        let detectedLanguage: SupportedLanguage = "en";
        try {
          if (isTauri()) {
            const { locale } = await import("@tauri-apps/plugin-os");
            const systemLocale = (await locale()) || navigator.language || "en";
            detectedLanguage = getSupportedLanguage(systemLocale);
          } else {
            detectedLanguage = getSupportedLanguage(navigator.language || "en");
          }
        } catch (error) {
          console.log("Failed to get system locale:", error);
          detectedLanguage = getSupportedLanguage(navigator.language || "en");
        }
        await get().setLanguage(detectedLanguage);
      }
    } catch (error) {
      console.error("Failed to load language:", error);
      set({ language: "en" }); // Fallback to English
    } finally {
      set({ isLoading: false });
    }
  },
}));
