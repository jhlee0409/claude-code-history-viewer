import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";
import {
  createInspectorSlice,
  DEFAULT_INSPECTOR_PREFS,
  INSPECTOR_STORAGE_KEY,
  INSPECTOR_WIDTH,
  parseInspectorPrefs,
  type InspectorSlice,
} from "./inspectorSlice";
import type { FullAppStore } from "./types";

type Creator = StateCreator<FullAppStore, [], [], InspectorSlice>;

/** A fresh store per test: the slice reads storage when it is created. */
const makeStore = () =>
  create<InspectorSlice>()((set, get, api) =>
    createInspectorSlice(
      set as unknown as Parameters<Creator>[0],
      get as unknown as Parameters<Creator>[1],
      api as unknown as Parameters<Creator>[2],
    ),
  );

const stored = () => JSON.parse(localStorage.getItem(INSPECTOR_STORAGE_KEY) ?? "null");

describe("inspectorSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is closed by default, on the outline, at the navigator's width", () => {
    const s = makeStore().getState();
    expect(s.isInspectorOpen).toBe(false);
    expect(s.inspectorTab).toBe("outline");
    expect(s.inspectorWidth).toBe(280);
    // Nothing is written until the user changes something.
    expect(localStorage.getItem(INSPECTOR_STORAGE_KEY)).toBeNull();
  });

  it("restores the open state, tab and width after a reload", () => {
    const store = makeStore();
    store.getState().toggleInspector();
    store.getState().setInspectorTab("tokens");
    store.getState().setInspectorWidth(333);
    expect(stored()).toEqual({ open: true, tab: "tokens", width: 333 });

    const reloaded = makeStore().getState();
    expect(reloaded.isInspectorOpen).toBe(true);
    expect(reloaded.inspectorTab).toBe("tokens");
    expect(reloaded.inspectorWidth).toBe(333);
  });

  it("remembers a closed inspector too, keeping its tab and width", () => {
    const store = makeStore();
    store.getState().setInspectorOpen(true);
    store.getState().setInspectorTab("info");
    store.getState().setInspectorOpen(false);

    const reloaded = makeStore().getState();
    expect(reloaded.isInspectorOpen).toBe(false);
    expect(reloaded.inspectorTab).toBe("info");
  });

  it("clamps a width outside the allowed range and ignores a non-number", () => {
    const store = makeStore();
    store.getState().setInspectorWidth(10_000);
    expect(store.getState().inspectorWidth).toBe(INSPECTOR_WIDTH.max);
    store.getState().setInspectorWidth(12);
    expect(store.getState().inspectorWidth).toBe(INSPECTOR_WIDTH.min);
    store.getState().setInspectorWidth(Number.NaN);
    expect(store.getState().inspectorWidth).toBe(INSPECTOR_WIDTH.min);
  });

  it("ignores an unknown tab id", () => {
    const store = makeStore();
    store.getState().setInspectorTab("recentEdits" as never);
    expect(store.getState().inspectorTab).toBe("outline");
  });

  it("does not throw when storage is blocked, and still toggles", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const store = makeStore();
      expect(store.getState().isInspectorOpen).toBe(false);
      store.getState().toggleInspector();
      expect(store.getState().isInspectorOpen).toBe(true);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  describe("upgrade from the message navigator's keys", () => {
    it("keeps a navigator the user had open, at its width", () => {
      localStorage.setItem("navigator-open", "true");
      localStorage.setItem("navigator-width", "350");
      const s = makeStore().getState();
      expect(s.isInspectorOpen).toBe(true);
      expect(s.inspectorWidth).toBe(350);
      expect(s.inspectorTab).toBe("outline");
    });

    it("stays closed for a closed navigator and drops an out-of-range width", () => {
      localStorage.setItem("navigator-open", "false");
      localStorage.setItem("navigator-width", "9999");
      const s = makeStore().getState();
      expect(s.isInspectorOpen).toBe(false);
      expect(s.inspectorWidth).toBe(280);
    });

    it("prefers the inspector's own record once it exists", () => {
      localStorage.setItem("navigator-open", "true");
      localStorage.setItem(INSPECTOR_STORAGE_KEY, JSON.stringify({ open: false, tab: "info", width: 300 }));
      const s = makeStore().getState();
      expect(s.isInspectorOpen).toBe(false);
      expect(s.inspectorTab).toBe("info");
    });

    it("never writes or removes the navigator's keys", () => {
      localStorage.setItem("navigator-open", "true");
      const store = makeStore();
      store.getState().setInspectorOpen(false);
      expect(localStorage.getItem("navigator-open")).toBe("true");
      expect(localStorage.getItem("navigator-width")).toBeNull();
    });
  });

  describe("parseInspectorPrefs (stored input is untrusted)", () => {
    it.each([
      ["not JSON", "{oops"],
      ["an array", "[1,2]"],
      ["null", "null"],
      ["a string", '"open"'],
    ])("falls back to the defaults for %s", (_label, raw) => {
      expect(parseInspectorPrefs(raw)).toEqual(DEFAULT_INSPECTOR_PREFS);
    });

    it("validates each field on its own", () => {
      expect(parseInspectorPrefs(JSON.stringify({ open: "yes", tab: "tokens", width: 300 }))).toEqual({
        open: false,
        tab: "tokens",
        width: 300,
      });
      expect(parseInspectorPrefs(JSON.stringify({ open: true, tab: "__proto__", width: 300.5 }))).toEqual({
        open: true,
        tab: "outline",
        width: 280,
      });
      expect(parseInspectorPrefs(JSON.stringify({ open: true, tab: "info", width: 150 }))?.width).toBe(280);
    });

    it("returns null when nothing is stored, so the legacy keys are read", () => {
      expect(parseInspectorPrefs(null)).toBeNull();
    });
  });
});
