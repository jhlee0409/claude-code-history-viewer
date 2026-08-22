import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import type { StateCreator } from "zustand";
import {
  createRecentEditsPanelSlice,
  selectRecentEditsDensity,
  selectRecentEditsGrouping,
  type RecentEditsPanelSlice,
} from "./recentEditsPanelSlice";
import type { FullAppStore } from "./types";

/**
 * A fresh store per test, following `filterSlice.test.ts`. The slice reads
 * localStorage in its initializer, so the store has to be built after whatever
 * the test seeded.
 */
const makeStore = () =>
  create<RecentEditsPanelSlice>()((set, get, api) =>
    createRecentEditsPanelSlice(
      set as unknown as Parameters<
        StateCreator<FullAppStore, [], [], RecentEditsPanelSlice>
      >[0],
      get as unknown as Parameters<
        StateCreator<FullAppStore, [], [], RecentEditsPanelSlice>
      >[1],
      api as unknown as Parameters<
        StateCreator<FullAppStore, [], [], RecentEditsPanelSlice>
      >[2]
    )
  );

describe("recentEditsPanelSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("applies the documented defaults when localStorage is empty", () => {
    const s = makeStore().getState();

    expect(s.recentEditsMode).toBe("page");
    expect(s.recentEditsDensityPage).toBe("standard");
    expect(s.recentEditsDensityDock).toBe("compact");
    expect(s.recentEditsScope).toBe("session");
    expect(s.recentEditsGroupingProject).toBe("file");
    expect(s.recentEditsGroupingSession).toBe("edit");
    expect(s.recentEditsMissingOnly).toBe(false);
    expect(s.isRecentEditsDockOpen).toBe(false);
  });

  it("falls back to the defaults when localStorage holds garbage", () => {
    localStorage.setItem("recent-edits-mode", "sideways");
    localStorage.setItem("recent-edits-density-dock", "{}");
    localStorage.setItem("recent-edits-scope", "");
    localStorage.setItem("recent-edits-grouping-session", "null");
    localStorage.setItem("recent-edits-missing-only", "yes please");

    const s = makeStore().getState();

    expect(s.recentEditsMode).toBe("page");
    expect(s.recentEditsDensityDock).toBe("compact");
    expect(s.recentEditsScope).toBe("session");
    expect(s.recentEditsGroupingSession).toBe("edit");
    // Anything that is not the string "true" reads as false, matching
    // navigatorSlice.
    expect(s.recentEditsMissingOnly).toBe(false);
  });

  it("round-trips every persisted value", () => {
    const store = makeStore();
    store.getState().setRecentEditsMode("docked");
    store.getState().setRecentEditsDensity("page", "compact");
    store.getState().setRecentEditsDensity("docked", "standard");
    store.getState().setRecentEditsScope("project");
    store.getState().setRecentEditsGrouping("project", "edit");
    store.getState().setRecentEditsGrouping("session", "file");
    store.getState().setRecentEditsMissingOnly(true);
    store.getState().setRecentEditsDockOpen(true);

    const reloaded = makeStore().getState();

    expect(reloaded.recentEditsMode).toBe("docked");
    expect(reloaded.recentEditsDensityPage).toBe("compact");
    expect(reloaded.recentEditsDensityDock).toBe("standard");
    expect(reloaded.recentEditsScope).toBe("project");
    expect(reloaded.recentEditsGroupingProject).toBe("edit");
    expect(reloaded.recentEditsGroupingSession).toBe("file");
    expect(reloaded.recentEditsMissingOnly).toBe(true);
    expect(reloaded.isRecentEditsDockOpen).toBe(true);
  });

  it("keeps page and dock density independent", () => {
    // Docking must not re-densify the full page view.
    const store = makeStore();
    store.getState().setRecentEditsDensity("docked", "standard");

    expect(store.getState().recentEditsDensityDock).toBe("standard");
    expect(store.getState().recentEditsDensityPage).toBe("standard");

    store.getState().setRecentEditsDensity("page", "compact");

    expect(store.getState().recentEditsDensityPage).toBe("compact");
    expect(store.getState().recentEditsDensityDock).toBe("standard");
  });

  it("keeps project and session grouping independent", () => {
    const store = makeStore();
    store.getState().setRecentEditsGrouping("project", "edit");

    expect(store.getState().recentEditsGroupingProject).toBe("edit");
    expect(store.getState().recentEditsGroupingSession).toBe("edit");

    store.getState().setRecentEditsGrouping("session", "file");

    expect(store.getState().recentEditsGroupingSession).toBe("file");
    expect(store.getState().recentEditsGroupingProject).toBe("edit");
  });

  it("toggles the dock and persists the new value", () => {
    const store = makeStore();
    store.getState().toggleRecentEditsDock();

    expect(store.getState().isRecentEditsDockOpen).toBe(true);
    expect(makeStore().getState().isRecentEditsDockOpen).toBe(true);

    store.getState().toggleRecentEditsDock();

    expect(store.getState().isRecentEditsDockOpen).toBe(false);
  });

  it("selects the density and grouping that currently apply", () => {
    const store = makeStore();

    expect(selectRecentEditsDensity(store.getState())).toBe("standard");
    expect(selectRecentEditsGrouping(store.getState())).toBe("edit");

    store.getState().setRecentEditsMode("docked");
    store.getState().setRecentEditsScope("project");

    expect(selectRecentEditsDensity(store.getState())).toBe("compact");
    expect(selectRecentEditsGrouping(store.getState())).toBe("file");
  });
});
