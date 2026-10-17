import { describe, expect, it } from "vitest";
import type { View } from "@/navigation/place";
import { isInspectorAvailable, isInspectorPlace } from "./inspectorAvailability";

const ALL_VIEWS: Record<View, true> = {
  empty: true,
  conversation: true,
  analytics: true,
  edits: true,
  board: true,
  globalStats: true,
  archive: true,
  settingsManager: true,
  tokenStats: true,
};
const VIEWS = Object.keys(ALL_VIEWS) as View[];

describe("where the inspector can show", () => {
  it("sits beside the conversation screen only, and only with a session open", () => {
    expect(VIEWS.filter((view) => isInspectorPlace({ view, hasSession: true }))).toEqual(["conversation"]);
    expect(VIEWS.filter((view) => isInspectorPlace({ view, hasSession: false }))).toEqual([]);
  });

  it("is never available on a phone", () => {
    expect(isInspectorAvailable({ isMobile: false, view: "conversation", hasSession: true })).toBe(true);
    expect(isInspectorAvailable({ isMobile: true, view: "conversation", hasSession: true })).toBe(false);
    expect(isInspectorAvailable({ isMobile: false, view: "conversation", hasSession: false })).toBe(false);
    expect(isInspectorAvailable({ isMobile: false, view: "analytics", hasSession: true })).toBe(false);
  });
});
