import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { createSettingsSlice } from "@/store/slices/settingsSlice";
import type { AppStore } from "@/store/useAppStore";
import { supportsReadingView } from "@/utils/providers";
import { storageAdapter } from "@/services/storage";

const { persisted, save, errorToast } = vi.hoisted(() => ({
  persisted: new Map<string, unknown>(),
  save: vi.fn(),
  errorToast: vi.fn(),
}));
vi.mock("@/services/storage", () => ({
  storageAdapter: { load: vi.fn(async () => ({
    get: async (key: string) => persisted.get(key),
    set: async (key: string, value: unknown) => { persisted.set(key, value); },
    save,
  })) },
}));
vi.mock("sonner", () => ({ toast: { error: errorToast } }));

const makeStore = () => create<AppStore>()((set, get, api) => ({
  navigationEpoch: 0,
  ...createSettingsSlice(set, get, api),
}) as unknown as AppStore);

beforeEach(() => { persisted.clear(); vi.clearAllMocks(); save.mockResolvedValue(undefined); });

describe("reading mode preference", () => {
  it("defaults to standard and restores a valid preference", async () => {
    const store = makeStore();
    expect(store.getState().viewerMode).toBe("standard");
    persisted.set("viewerMode", "reading");
    await store.getState().loadViewerMode();
    expect(store.getState().viewerMode).toBe("reading");
  });
  it("does not let startup restoration overwrite a newer choice", async () => {
    let finishLoad!: (mode: string) => void;
    vi.mocked(storageAdapter.load).mockResolvedValueOnce({
      get: () => new Promise<string>((resolve) => { finishLoad = resolve; }),
    } as unknown as Awaited<ReturnType<typeof storageAdapter.load>>);
    const store = makeStore();
    const loading = store.getState().loadViewerMode();
    await vi.waitFor(() => expect(finishLoad).toBeDefined());
    await store.getState().setViewerMode("standard");
    finishLoad("reading");
    await loading;
    expect(store.getState().viewerMode).toBe("standard");
  });
  it("keeps upstream filter reloads in place instead of navigating", () => {
    const store = makeStore();
    const reloadCurrent = vi.fn(async () => {});
    const reloadProjectSessions = vi.fn(async () => {});
    const selectSession = vi.fn();
    store.setState({
      selectedProject: { path: "/history/project" } as AppStore["selectedProject"],
      selectedSession: { file_path: "/history/session.jsonl" } as AppStore["selectedSession"],
      reloadCurrent, reloadProjectSessions, selectSession,
    });
    store.getState().setExcludeSidechain(false);
    store.getState().setShowSystemMessages(true);
    expect(reloadProjectSessions).toHaveBeenCalledOnce();
    expect(reloadCurrent.mock.calls).toEqual([["filter"], ["filter"]]);
    expect(selectSession).not.toHaveBeenCalled();
  });
  it("retains the upstream system contrast default when restoring settings", async () => {
    const store = makeStore();
    expect(store.getState().highContrast).toBeNull();
    await store.getState().loadUpdateSettings();
    expect(store.getState().highContrast).toBeNull();
    persisted.set("highContrast", false);
    await store.getState().loadUpdateSettings();
    expect(store.getState().highContrast).toBe(false);
  });
  it("ignores invalid persisted modes", async () => {
    persisted.set("viewerMode", "unexpected");
    const store = makeStore();
    await store.getState().loadViewerMode();
    expect(store.getState().viewerMode).toBe("standard");
  });
  it("serializes rapid choices so an older save cannot overwrite the latest", async () => {
    let finishFirst!: () => void;
    save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    const store = makeStore();
    const first = store.getState().setViewerMode("reading");
    const last = store.getState().setViewerMode("standard");
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(store.getState().viewerMode).toBe("standard");
    finishFirst();
    await Promise.all([first, last]);
    expect(persisted.get("viewerMode")).toBe("standard");
  });
  it("suppresses a queued save failure after navigation from its initiating place", async () => {
    let finishFirst!: () => void;
    save.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    save.mockRejectedValueOnce(new Error("queued save failed"));
    const store = makeStore();
    const first = store.getState().setViewerMode("reading");
    const queued = store.getState().setViewerMode("standard");
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    store.setState({ navigationEpoch: 1 });
    finishFirst();
    await Promise.all([first, queued]);
    expect(store.getState().viewerMode).toBe("standard");
    expect(errorToast).not.toHaveBeenCalled();
  });
  it("suppresses preference restoration feedback after navigation", async () => {
    let failLoad!: (reason: Error) => void;
    vi.mocked(storageAdapter.load).mockImplementationOnce(() => new Promise((_, reject) => { failLoad = reject; }));
    const store = makeStore();
    const loading = store.getState().loadViewerMode();
    store.setState({ navigationEpoch: 1 });
    failLoad(new Error("read failed"));
    await loading;
    expect(errorToast).not.toHaveBeenCalled();
  });
  it("reports preference restoration failures while the place still owns feedback", async () => {
    vi.mocked(storageAdapter.load).mockRejectedValueOnce(new Error("read failed"));
    const store = makeStore();
    await store.getState().loadViewerMode();
    expect(errorToast).toHaveBeenCalledOnce();
  });
  it("persists the choice and reports storage failures", async () => {
    const store = makeStore();
    await store.getState().setViewerMode("reading");
    expect(persisted.get("viewerMode")).toBe("reading");
    expect(save).toHaveBeenCalledOnce();
    save.mockRejectedValueOnce(new Error("disk full"));
    await store.getState().setViewerMode("standard");
    expect(errorToast).toHaveBeenCalledOnce();
  });
});

describe("reading provider support", () => {
  it("supports only explicit Claude identities", () => {
    expect(supportsReadingView("claude")).toBe(true);
    for (const provider of ["codex", "opencode", "unknown", "", undefined]) {
      expect(supportsReadingView(provider)).toBe(false);
    }
  });
  it("does not overwrite a reading preference when checking another provider", async () => {
    const store = makeStore();
    await store.getState().setViewerMode("reading");
    expect(supportsReadingView("codex")).toBe(false);
    expect(store.getState().viewerMode).toBe("reading");
    expect(supportsReadingView("claude")).toBe(true);
  });
});
