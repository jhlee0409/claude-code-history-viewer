import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";
import { createNavigatorSlice, type NavigatorSlice } from "./navigatorSlice";
import type { FullAppStore } from "./types";

/**
 * A fresh store per test, following `recentEditsPanelSlice.test.ts`. The
 * slice reads localStorage in its initializer, so the store has to be built
 * after whatever the test seeded.
 */
const makeStore = () =>
  create<NavigatorSlice>()((set, get, api) =>
    createNavigatorSlice(
      set as unknown as Parameters<
        StateCreator<FullAppStore, [], [], NavigatorSlice>
      >[0],
      get as unknown as Parameters<
        StateCreator<FullAppStore, [], [], NavigatorSlice>
      >[1],
      api as unknown as Parameters<
        StateCreator<FullAppStore, [], [], NavigatorSlice>
      >[2]
    )
  );

describe("navigatorSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("applies the documented defaults when localStorage is empty", () => {
    const s = makeStore().getState();

    expect(s.isNavigatorOpen).toBe(true);
    expect(s.navigatorViewMode).toBe("list");
    expect(s.visibleMessageUuid).toBeNull();
  });

  it("round-trips navigatorViewMode through localStorage", () => {
    const store = makeStore();
    store.getState().setNavigatorViewMode("outline");

    expect(store.getState().navigatorViewMode).toBe("outline");
    expect(localStorage.getItem("navigator-view-mode")).toBe("outline");

    // A fresh store (simulating reload) picks up the persisted value.
    const reloaded = makeStore();
    expect(reloaded.getState().navigatorViewMode).toBe("outline");
  });

  it("toggleNavigatorViewMode flips between list and outline and persists", () => {
    const store = makeStore();

    store.getState().toggleNavigatorViewMode();
    expect(store.getState().navigatorViewMode).toBe("outline");
    expect(localStorage.getItem("navigator-view-mode")).toBe("outline");

    store.getState().toggleNavigatorViewMode();
    expect(store.getState().navigatorViewMode).toBe("list");
    expect(localStorage.getItem("navigator-view-mode")).toBe("list");
  });

  it("reads any stored value other than list/outline as list", () => {
    localStorage.setItem("navigator-view-mode", "sideways");
    expect(makeStore().getState().navigatorViewMode).toBe("list");

    localStorage.setItem("navigator-view-mode", "");
    expect(makeStore().getState().navigatorViewMode).toBe("list");
  });

  it("does not persist visibleMessageUuid", () => {
    const store = makeStore();
    store.getState().setVisibleMessageUuid("message-1");

    expect(store.getState().visibleMessageUuid).toBe("message-1");
    expect(localStorage.getItem("visible-message-uuid")).toBeNull();

    const reloaded = makeStore();
    expect(reloaded.getState().visibleMessageUuid).toBeNull();
  });

  it("does not call set when visibleMessageUuid is unchanged", () => {
    // Direct set/get mocks, following navigationSlice.test.ts: a full
    // zustand store's `set` is captured by reference at creation time, so
    // spying on `store.setState` afterward does not intercept it.
    const set = vi.fn();
    const get = () => ({ visibleMessageUuid: "message-1" });
    const slice = createNavigatorSlice(set as never, get as never, {} as never);

    slice.setVisibleMessageUuid("message-1");
    expect(set).not.toHaveBeenCalled();

    slice.setVisibleMessageUuid("message-2");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ visibleMessageUuid: "message-2" });
  });

  it("does not crash when localStorage throws on read or write", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => {
      const store = makeStore();
      expect(store.getState().navigatorViewMode).toBe("list");
      expect(store.getState().isNavigatorOpen).toBe(true);
    }).not.toThrow();

    getItemSpy.mockRestore();

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => {
      const store = makeStore();
      store.getState().setNavigatorViewMode("outline");
      expect(store.getState().navigatorViewMode).toBe("outline");
      store.getState().toggleNavigatorViewMode();
      expect(store.getState().navigatorViewMode).toBe("list");
    }).not.toThrow();

    setItemSpy.mockRestore();
  });
});
