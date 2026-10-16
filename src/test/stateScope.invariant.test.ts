/**
 * Every store field is classified for conversation tabs (T8 review #5):
 * `src/navigation/stateScope.ts` says whether it is the tab's own
 * (`document`), started empty on every switch (`reset`), loaded for the
 * open place (`reloaded`) or the window's (`app`). A field added to the
 * store without a classification fails here, so a new per-view field
 * cannot silently leak from one tab into another.
 *
 * `navigation.tabs.test.ts` holds the behaviour: every `document` field
 * comes back with its tab and every `reset` field starts empty on a switch.
 */
import { describe, expect, it } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { STATE_SCOPE } from "@/navigation/stateScope";

const stateFields = (): string[] => {
  const state = useAppStore.getState() as unknown as Record<string, unknown>;
  return Object.keys(state)
    .filter((key) => typeof state[key] !== "function")
    .sort();
};

describe("store fields × tabs", () => {
  it("every store field is classified", () => {
    const unclassified = stateFields().filter((field) => !(field in STATE_SCOPE));
    expect(unclassified, "classify these in src/navigation/stateScope.ts").toEqual([]);
  });

  it("every classified field still exists", () => {
    const fields = new Set(stateFields());
    const stale = Object.keys(STATE_SCOPE).filter((field) => !fields.has(field));
    expect(stale, "remove these from src/navigation/stateScope.ts").toEqual([]);
  });

  it("self-check: a new field is caught", () => {
    const withNew = [...stateFields(), "brandNewPerViewField"];
    expect(withNew.filter((field) => !(field in STATE_SCOPE))).toEqual(["brandNewPerViewField"]);
  });
});
