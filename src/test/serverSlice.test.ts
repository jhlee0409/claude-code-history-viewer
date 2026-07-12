import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import {
  createServerSlice,
  type ServerSlice,
} from "@/store/slices/serverSlice";
import { api } from "@/services/api";
import { isTauri } from "@/utils/platform";

vi.mock("@/services/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/utils/platform", () => ({
  isTauri: vi.fn(),
}));

const createTestStore = () =>
  create<ServerSlice>()((set, get) => ({
    ...createServerSlice(
      set as unknown as Parameters<typeof createServerSlice>[0],
      get as unknown as Parameters<typeof createServerSlice>[1],
      {} as unknown as Parameters<typeof createServerSlice>[2],
    ),
  }));

describe("serverSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it("loads read-only mode from WebUI server config", async () => {
    vi.mocked(api).mockResolvedValue({ readOnly: true });
    const useStore = createTestStore();

    await useStore.getState().loadServerConfig();

    expect(api).toHaveBeenCalledWith("get_server_config");
    expect(useStore.getState().isServerReadOnly).toBe(true);
    expect(useStore.getState().isServerConfigLoaded).toBe(true);
  });

  it("defaults to writable in Tauri desktop mode", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const useStore = createTestStore();

    await useStore.getState().loadServerConfig();

    expect(api).not.toHaveBeenCalled();
    expect(useStore.getState().isServerReadOnly).toBe(false);
    expect(useStore.getState().isServerConfigLoaded).toBe(true);
  });
});
