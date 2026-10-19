/**
 * Every store field is classified for conversation tabs (T8 review #5):
 * `src/navigation/stateScope.ts` says whether it is the tab's own
 * (`document`), started over on every switch (`reset`), the open place's
 * transcript and list (`reloaded`), a screen's data (`screen`) or the
 * window's (`app`). A field added to the store without a classification
 * fails here, so a new per-view field cannot silently leak from one tab
 * into another.
 *
 * The labels are not the proof: `navigation.tabs.test.ts` drives a real
 * switch for every scope, field by field ("every `<scope>` field …
 * (stateScope)"), and the last test here fails when a scope has no such
 * behaviour test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { STATE_SCOPE, type StateScope } from "@/navigation/stateScope";

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

  it("every scope has a behaviour test over a real tab switch", () => {
    const behaviour = readFileSync(path.resolve(__dirname, "navigation.tabs.test.ts"), "utf8");
    const scopes = [...new Set(Object.values(STATE_SCOPE))] as StateScope[];
    expect(scopes.sort()).toEqual(["app", "document", "reloaded", "reset", "screen"]);
    const untested = scopes.filter((scope) => !behaviour.includes(`it("every \`${scope}\` field`));
    expect(untested, "add an \"every `<scope>` field …\" test to navigation.tabs.test.ts").toEqual([]);
  });

  it("self-check: a new field is caught", () => {
    const withNew = [...stateFields(), "brandNewPerViewField"];
    expect(withNew.filter((field) => !(field in STATE_SCOPE))).toEqual(["brandNewPerViewField"]);
  });
});
