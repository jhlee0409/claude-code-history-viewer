import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { api } from "../services/api";
import {
  createProviderSlice,
  type ProviderSlice,
} from "../store/slices/providerSlice";

vi.mock("../services/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const createTestStore = () =>
  create<ProviderSlice>()((set, get, store) =>
    createProviderSlice(
      set as unknown as Parameters<typeof createProviderSlice>[0],
      get as unknown as Parameters<typeof createProviderSlice>[1],
      store as unknown as Parameters<typeof createProviderSlice>[2],
    )
  );

describe("providerSlice", () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it("preserves the last known providers when detection fails", async () => {
    const store = createTestStore();
    const previousProviders = [
      {
        id: "codex" as const,
        display_name: "Codex",
        base_path: "/root/.codex",
        is_available: true,
      },
    ];
    store.setState({
      providers: previousProviders,
      activeProviders: ["codex"],
    });
    vi.mocked(api).mockRejectedValue(new Error("detect failed"));

    await expect(store.getState().detectProviders()).resolves.toBe(false);

    expect(store.getState().providers).toEqual(previousProviders);
    expect(store.getState().activeProviders).toEqual(["codex"]);
    expect(store.getState().isDetectingProviders).toBe(false);
  });
});
