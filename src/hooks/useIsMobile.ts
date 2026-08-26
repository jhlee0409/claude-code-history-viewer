import { useMediaQuery } from "./useMediaQuery";

const MOBILE_BREAKPOINT = 767;

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT}px)`);
}
