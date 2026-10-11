import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";

import { createMinimapSlice, type MinimapSlice } from "./minimapSlice";
import type { FullAppStore } from "./types";

/**
 * A fresh store per test, following `recentEditsPanelSlice.test.ts`. The
 * slice reads localStorage in its initializer, so the store has to be built
 * after whatever the test seeded.
 */
const makeStore = () =>
    create<MinimapSlice>()((set, get, api) =>
        createMinimapSlice(
            set as unknown as Parameters<
                StateCreator<FullAppStore, [], [], MinimapSlice>
            >[0],
            get as unknown as Parameters<
                StateCreator<FullAppStore, [], [], MinimapSlice>
            >[1],
            api as unknown as Parameters<
                StateCreator<FullAppStore, [], [], MinimapSlice>
            >[2]
        )
    );

describe("minimapSlice", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("defaults isMinimapOpen to false when nothing is stored", () => {
        const s = makeStore().getState();

        expect(s.isMinimapOpen).toBe(false);
    });

    it("setMinimapOpen writes and reads back through localStorage", () => {
        const store = makeStore();
        store.getState().setMinimapOpen(true);

        expect(store.getState().isMinimapOpen).toBe(true);
        expect(localStorage.getItem("minimap-open")).toBe("true");

        // A fresh store reads the persisted value back.
        expect(makeStore().getState().isMinimapOpen).toBe(true);
    });

    it("toggleMinimap flips and persists the new value", () => {
        const store = makeStore();
        store.getState().toggleMinimap();

        expect(store.getState().isMinimapOpen).toBe(true);
        expect(makeStore().getState().isMinimapOpen).toBe(true);

        store.getState().toggleMinimap();

        expect(store.getState().isMinimapOpen).toBe(false);
        expect(makeStore().getState().isMinimapOpen).toBe(false);
    });

    it("falls back to the default when a stored value is not the string \"true\"", () => {
        localStorage.setItem("minimap-open", "yes please");

        expect(makeStore().getState().isMinimapOpen).toBe(false);
    });

    it("does not crash when localStorage.getItem throws on init", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("boom");
        });

        expect(() => makeStore().getState()).not.toThrow();
        expect(makeStore().getState().isMinimapOpen).toBe(false);

        vi.restoreAllMocks();
    });

    it("does not crash when localStorage.setItem throws on write", () => {
        const store = makeStore();
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("boom");
        });

        expect(() => store.getState().setMinimapOpen(true)).not.toThrow();
        expect(store.getState().isMinimapOpen).toBe(true);

        vi.restoreAllMocks();
    });

    it("does not crash when localStorage.setItem throws during toggle", () => {
        const store = makeStore();
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("boom");
        });

        expect(() => store.getState().toggleMinimap()).not.toThrow();
        expect(store.getState().isMinimapOpen).toBe(true);

        vi.restoreAllMocks();
    });
});
