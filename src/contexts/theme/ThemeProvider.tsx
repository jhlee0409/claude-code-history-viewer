import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemeContext, type Theme } from "@/contexts/theme/context";
import { loadThemeFromTauriStore, saveThemeToTauriStore } from "./utils";

const initialState = {
  theme: "system" as Theme,
};

type ThemeProviderProps = {
  children: React.ReactNode;
};

/**
 * Calculates whether dark mode should be active based on theme setting
 * and system preference.
 */
function calculateIsDarkMode(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  // theme === "system"
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(initialState.theme);
  // Track isDarkMode as state to ensure re-renders on system theme changes
  const [isDarkMode, setIsDarkMode] = useState(() => calculateIsDarkMode(initialState.theme));

  const handleSetTheme = useCallback(async (newTheme: Theme) => {
    setTheme(newTheme);
    setIsDarkMode(calculateIsDarkMode(newTheme));
    await saveThemeToTauriStore(newTheme);
  }, []);

  const initializeTheme = useCallback(async () => {
    const savedTheme = await loadThemeFromTauriStore();
    if (savedTheme) {
      setTheme(savedTheme);
      setIsDarkMode(calculateIsDarkMode(savedTheme));
    }
  }, []);

  // Initialize theme from store on mount
  useEffect(() => {
    initializeTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme class to document and listen for system theme changes
  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
      setIsDarkMode(isDark);
    };

    if (theme === "system") {
      // Check system preference
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      // Listen for system theme changes
      const handleChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches);
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      applyTheme(theme === "dark");
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: handleSetTheme,
      initializeTheme,
      isDarkMode,
    }),
    [isDarkMode, theme, initializeTheme, handleSetTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
