/* eslint-disable react-refresh/only-export-components */
/**
 * CaptureExpandContext
 *
 * Provides a shared expand state registry for WYSIWYG capture.
 * Each collapsible component registers its state with a unique key
 * (messageUuid + suffix), enabling the capture renderer to mirror
 * the exact expand/collapse state from the main UI.
 */

import { createContext, useCallback, useContext } from "react";
import { useExpandRegistry } from "@/store/expandRegistryStore";

/** Context for message-scoped expand key prefix */
const ExpandKeyContext = createContext<string>("");

/** Provider to set the expand key prefix (typically message UUID) */
export const ExpandKeyProvider = ExpandKeyContext.Provider;

/** Current expand-key prefix, for nesting a narrower scope under it. */
export function useExpandKeyPrefix(): string {
  return useContext(ExpandKeyContext);
}

/**
 * Drop-in replacement for useState<boolean> with shared state registry.
 *
 * State is stored in a global Zustand store keyed by `${prefix}:${suffix}`,
 * so both the main UI and the capture renderer (which renders the same
 * message data) share identical expand/collapse state.
 *
 * Must be used within an ExpandKeyProvider. Throws if provider is missing,
 * since a missing provider causes silent key mismatches between main UI
 * and capture renderer.
 *
 * @param suffix - Unique identifier within a message (e.g., "thinking-0", "file:/path.ts:1")
 * @param initialState - Default collapsed/expanded value
 */
export function useCaptureExpandState(
  suffix: string,
  initialState: boolean,
): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const prefix = useContext(ExpandKeyContext);
  if (!prefix) {
    throw new Error("useCaptureExpandState must be used within ExpandKeyProvider");
  }
  const key = `${prefix}:${suffix}`;

  const value = useExpandRegistry(
    useCallback((s: { states: Record<string, boolean> }) => s.states[key], [key]),
  );
  const setExpanded = useExpandRegistry((s) => s.setExpanded);

  const resolved = value ?? initialState;

  const setter = useCallback(
    (action: boolean | ((prev: boolean) => boolean)) => {
      const currentVal =
        useExpandRegistry.getState().states[key] ?? initialState;
      const newVal = typeof action === "function" ? action(currentVal) : action;
      setExpanded(key, newVal);
    },
    [key, initialState, setExpanded],
  );

  return [resolved, setter];
}
