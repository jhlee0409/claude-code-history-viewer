import { api } from "@/services/api";
import { isTauri } from "@/utils/platform";
import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

interface ServerConfig {
  readOnly?: boolean;
}

export interface ServerSliceState {
  isServerReadOnly: boolean;
  isServerConfigLoaded: boolean;
}

export interface ServerSliceActions {
  loadServerConfig: () => Promise<void>;
}

export type ServerSlice = ServerSliceState & ServerSliceActions;

const initialServerState: ServerSliceState = {
  isServerReadOnly: false,
  isServerConfigLoaded: false,
};

export const createServerSlice: StateCreator<
  FullAppStore,
  [],
  [],
  ServerSlice
> = (set) => ({
  ...initialServerState,

  loadServerConfig: async () => {
    if (isTauri()) {
      set({ isServerReadOnly: false, isServerConfigLoaded: true });
      return;
    }

    try {
      const config = await api<ServerConfig>("get_server_config");
      set({
        isServerReadOnly: config.readOnly === true,
        isServerConfigLoaded: true,
      });
    } catch (error) {
      console.warn("Failed to load server config:", error);
      set({ isServerReadOnly: false, isServerConfigLoaded: true });
    }
  },
});
