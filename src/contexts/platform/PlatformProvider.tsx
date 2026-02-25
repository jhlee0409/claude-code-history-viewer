import { useMemo, type ReactNode } from "react";
import { isTauri } from "@/utils/platform";
import { PlatformContext, type PlatformContextValue } from "./context";

export function PlatformProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PlatformContextValue>(() => {
    const desktop = isTauri();

    return {
      platform: desktop ? "desktop" : "web",
      capabilities: {
        autoUpdate: desktop,
        fileWatcher: desktop,
        nativeDialogs: desktop,
        systemLocale: desktop,
      },
      isDesktop: desktop,
      isWeb: !desktop,
    };
  }, []);

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}
