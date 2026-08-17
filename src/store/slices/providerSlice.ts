/**
 * Provider Slice
 *
 * Manages multi-provider detection and filtering state.
 */

import { api } from "@/services/api";
import { toast } from "sonner";
import type { ProviderId, ProviderInfo } from "../../types";
import i18n from "../../i18n";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";
import { DEFAULT_PROVIDER_ID } from "../../utils/providers";

// ============================================================================
// State Interface
// ============================================================================

export interface ProviderSliceState {
  providers: ProviderInfo[];
  activeProviders: ProviderId[];
  isDetectingProviders: boolean;
}

export interface ProviderSliceActions {
  /** Returns true when detection completed and false when the previous state was preserved. */
  detectProviders: () => Promise<boolean>;
  toggleProvider: (id: ProviderId) => void;
  setActiveProviders: (ids: ProviderId[]) => void;
}

export type ProviderSlice = ProviderSliceState & ProviderSliceActions;

// ============================================================================
// Initial State
// ============================================================================

const initialProviderState: ProviderSliceState = {
  providers: [],
  activeProviders: [DEFAULT_PROVIDER_ID],
  isDetectingProviders: false,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createProviderSlice: StateCreator<
  FullAppStore,
  [],
  [],
  ProviderSlice
> = (set) => ({
  ...initialProviderState,

  detectProviders: async () => {
    set({ isDetectingProviders: true });
    try {
      const providers = await api<ProviderInfo[]>("detect_providers");
      const activeProviders = providers
        .filter((p) => p.is_available)
        .map((p) => p.id as ProviderId);
      set({
        providers,
        activeProviders: activeProviders.length > 0
          ? activeProviders
          : [DEFAULT_PROVIDER_ID],
      });
      return true;
    } catch (error) {
      console.error("Failed to detect providers:", error);
      toast.error(i18n.t("common.provider.detectError"));
      // Keep the last known state. The caller may still have persisted
      // provider IDs that must not be replaced with an empty result after a
      // transient detection failure.
      return false;
    } finally {
      set({ isDetectingProviders: false });
    }
  },

  toggleProvider: (id: ProviderId) => {
    set((state) => {
      const current = state.activeProviders;
      const next = current.includes(id)
        ? current.filter((p) => p !== id)
        : [...current, id];
      // Ensure at least one provider is active
      return { activeProviders: next.length > 0 ? next : current };
    });
  },

  setActiveProviders: (ids: ProviderId[]) => {
    set({ activeProviders: ids });
  },
});
