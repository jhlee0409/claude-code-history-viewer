import type { ReactNode } from "react";
import { usePlatform } from "./context";

export function DesktopOnly({ children }: { children: ReactNode }) {
  const { isDesktop } = usePlatform();
  return isDesktop ? <>{children}</> : null;
}
