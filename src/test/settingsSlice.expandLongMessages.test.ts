/**
 * Issue #574: "Expand long messages by default" is persisted to
 * settings.json and restored on load, defaulting to off.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { storageAdapter } from "@/services/storage";
import { createSettingsSlice } from "../store/slices/settingsSlice";
import type { AppStore } from "../store/useAppStore";

vi.mock("@/services/storage", () => ({
  storageAdapter: { load: vi.fn() },
}));

const saved = new Map<string, unknown>();
const fakeStore = {
  get: vi.fn(async (key: string) => saved.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    saved.set(key, value);
  }),
  save: vi.fn(async () => {}),
};

function createTestStore() {
  return create<AppStore>()(
    (set, get, api) =>
      ({ ...createSettingsSlice(set, get, api) }) as unknown as AppStore,
  );
}

describe("expandLongMessages setting", () => {
  beforeEach(() => {
    saved.clear();
    vi.clearAllMocks();
    vi.mocked(storageAdapter.load).mockResolvedValue(
      fakeStore as unknown as Awaited<ReturnType<typeof storageAdapter.load>>,
    );
  });

  it("is off by default", async () => {
    const store = createTestStore();
    expect(store.getState().expandLongMessages).toBe(false);

    await store.getState().loadUpdateSettings();
    expect(store.getState().expandLongMessages).toBe(false);
  });

  it("persists the value and restores it on load", async () => {
    await createTestStore().getState().setExpandLongMessages(true);

    expect(saved.get("expandLongMessages")).toBe(true);
    expect(fakeStore.save).toHaveBeenCalled();

    const reloaded = createTestStore();
    await reloaded.getState().loadUpdateSettings();
    expect(reloaded.getState().expandLongMessages).toBe(true);
  });
});
