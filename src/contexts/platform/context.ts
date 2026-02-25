import { createContext, useContext } from "react";

export type PlatformType = "desktop" | "web";

export interface PlatformCapabilities {
  autoUpdate: boolean;
  fileWatcher: boolean;
  nativeDialogs: boolean;
  systemLocale: boolean;
}

export interface PlatformContextValue {
  platform: PlatformType;
  capabilities: PlatformCapabilities;
  isDesktop: boolean;
  isWeb: boolean;
}

export const PlatformContext = createContext<PlatformContextValue | null>(null);

export function usePlatform() {
  const value = useContext(PlatformContext);

  if (!value) {
    throw new Error("usePlatform must be used within a PlatformProvider");
  }

  return value;
}
