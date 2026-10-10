import { useAppStore } from "../store/useAppStore";
import { useIsMdUp } from "./useMediaQuery";

/**
 * Whether the session minimap strip should be mounted and the message list
 * padded for it. A single source of truth so the two can never disagree.
 */
export function useMinimapVisible(): boolean {
    const isMinimapOpen = useAppStore((state) => state.isMinimapOpen);
    const isCaptureMode = useAppStore((state) => state.isCaptureMode);
    const isMdUp = useIsMdUp();

    return isMinimapOpen && !isCaptureMode && isMdUp;
}
