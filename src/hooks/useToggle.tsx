/**
 * Toggle Hook
 *
 * Simple boolean state toggle utility for managing open/closed states.
 * Respects CaptureExpandContext — always open during screenshot capture.
 *
 * @example
 * const [isOpen, toggle] = useToggle();
 */

import { useCaptureExpandState } from "@/contexts/CaptureExpandContext";

type BooleanStateSetter = (value: boolean | ((prev: boolean) => boolean)) => void;
type BooleanStateHook = (initialState: boolean) => [boolean, BooleanStateSetter];

export const createUseToggle = (useBooleanState: BooleanStateHook) => (): [boolean, () => void] => {
  // Intentional composition: capture-aware state keeps expandable UI open during screenshot capture.
  const [isOpen, setIsOpen] = useBooleanState(false);
  const toggle = () => setIsOpen((prev) => !prev);
  return [isOpen, toggle];
};

export const useToggle = createUseToggle(useCaptureExpandState);
