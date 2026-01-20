import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import { locale } from "@tauri-apps/plugin-os";
import i18n from "../i18n";
import type { SupportedLanguage } from "../i18n";
import { languageLocaleMap } from "../i18n";

interface LanguageStore {
  language: SupportedLanguage;
  isLoading: boolean;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

const getSupportedLanguage = (lang: string): SupportedLanguage => {
  if (lang.startsWith("zh")) {
    const region = lang.split("-")[1]?.toUpperCase();
    if (region === "TW" || region === "HK" || region === "MO") {
      return "zh-TW";
    }
    return "zh-CN";
  }
  const primary = lang.split("-")[0];
  if (primary && primary in languageLocaleMap) {
    return primary as SupportedLanguage;
  }
  return "en";
};

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
    try {
      await i18n.changeLanguage(language);
      set({ language });

      const store = await load("settings.json", { autoSave: true });
      await store.set("language", language);
      await store.save();
    } catch (e) {
      console.log("Tauri Store not available or failed to save:", e);
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
          const store = await load("settings.json", { autoSave: true });
          language = (await store.get("language")) as SupportedLanguage | null;
        } catch (e) {
          console.log("Tauri Store not available:", e);
        }
      }

      if (language) {
        await i18n.changeLanguage(language);
        set({ language });
      } else {
        let detectedLanguage: SupportedLanguage = "en";
        try {
          const systemLocale = (await locale()) || navigator.language || "en";
          detectedLanguage = getSupportedLanguage(systemLocale);
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
