import { describe, expect, it } from "vitest";
import { create, type StoreApi } from "zustand";
import {
  createSessionSelectionSlice,
  type SessionSelectionSlice,
} from "../store/slices/sessionSelectionSlice";
import type { FullAppStore } from "../store/slices/types";

// The selection slice only reads/writes its own state, so it can be exercised
// in isolation; the casts bridge the FullAppStore-typed StateCreator to a
// slice-only store (same pattern as filterSlice.test.ts).
const makeStore = () =>
  create<SessionSelectionSlice>()((set, get, api) =>
    createSessionSelectionSlice(
      set as unknown as Parameters<typeof createSessionSelectionSlice>[0],
      get as unknown as () => FullAppStore,
      api as unknown as StoreApi<FullAppStore>,
    ),
  );

const IDS = ["a", "b", "c", "d", "e"];
const click = (shift = false, cmdOrCtrl = false) => ({ shift, cmdOrCtrl });

describe("sessionSelectionSlice", () => {
  it("starts inactive with an empty selection", () => {
    const s = makeStore().getState();
    expect(s.isSessionSelectionMode).toBe(false);
    expect(s.sessionSelectionIds).toEqual([]);
    expect(s.sessionSelectionAnchor).toBeNull();
  });

  it("toggleSessionSelectionMode enters, then exits clearing selection", () => {
    const store = makeStore();
    store.getState().toggleSessionSelectionMode();
    expect(store.getState().isSessionSelectionMode).toBe(true);

    store.getState().handleSessionSelectionClick("b", IDS, click());
    expect(store.getState().sessionSelectionIds).toEqual(["b"]);

    store.getState().toggleSessionSelectionMode();
    expect(store.getState().isSessionSelectionMode).toBe(false);
    expect(store.getState().sessionSelectionIds).toEqual([]);
    expect(store.getState().sessionSelectionAnchor).toBeNull();
  });

  it("plain click toggles a row on and off and moves the anchor", () => {
    const store = makeStore();
    store.getState().handleSessionSelectionClick("b", IDS, click());
    expect(store.getState().sessionSelectionIds).toEqual(["b"]);
    expect(store.getState().sessionSelectionAnchor).toBe("b");

    store.getState().handleSessionSelectionClick("d", IDS, click());
    expect(store.getState().sessionSelectionIds).toEqual(["b", "d"]);
    expect(store.getState().sessionSelectionAnchor).toBe("d");

    // Clicking an already-selected row removes it.
    store.getState().handleSessionSelectionClick("b", IDS, click());
    expect(store.getState().sessionSelectionIds).toEqual(["d"]);
  });

  it("cmd/ctrl click toggles individual rows like a plain click", () => {
    const store = makeStore();
    store.getState().handleSessionSelectionClick("a", IDS, click(false, true));
    store.getState().handleSessionSelectionClick("c", IDS, click(false, true));
    expect(new Set(store.getState().sessionSelectionIds)).toEqual(new Set(["a", "c"]));
  });

  it("shift click selects the inclusive range from the anchor and unions it in", () => {
    const store = makeStore();
    store.getState().handleSessionSelectionClick("b", IDS, click()); // anchor = b
    store.getState().handleSessionSelectionClick("d", IDS, click(true)); // b..d
    expect(new Set(store.getState().sessionSelectionIds)).toEqual(
      new Set(["b", "c", "d"]),
    );
    // Anchor is preserved so the range can be re-extended.
    expect(store.getState().sessionSelectionAnchor).toBe("b");
  });

  it("shift click with no anchor selects only the clicked row", () => {
    const store = makeStore();
    store.getState().handleSessionSelectionClick("c", IDS, click(true));
    expect(store.getState().sessionSelectionIds).toEqual(["c"]);
    expect(store.getState().sessionSelectionAnchor).toBe("c");
  });

  it("setSessionSelectionIds replaces the selection (Select all)", () => {
    const store = makeStore();
    store.getState().handleSessionSelectionClick("a", IDS, click());
    store.getState().setSessionSelectionIds(IDS);
    expect(store.getState().sessionSelectionIds).toEqual(IDS);
  });

  it("clearSessionSelection empties the selection but stays in mode", () => {
    const store = makeStore();
    store.getState().enterSessionSelectionMode();
    store.getState().setSessionSelectionIds(["a", "b"]);
    store.getState().clearSessionSelection();
    expect(store.getState().sessionSelectionIds).toEqual([]);
    expect(store.getState().sessionSelectionAnchor).toBeNull();
    expect(store.getState().isSessionSelectionMode).toBe(true);
  });
});
