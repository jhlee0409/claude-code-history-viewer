/**
 * Guards for the place model (plan T2 STOP WHEN).
 *
 * 1. The two old sources of "where am I" are gone for good: no
 *    `currentView`, no `isViewingGlobalStats` (or their setters) anywhere in
 *    the app source.
 * 2. Selection primitives are store-internal. Moving the user goes through
 *    `navigate`, reloading through `reloadCurrent`; the table below is the
 *    complete list of files allowed to call the primitives directly, with the
 *    reason. A new caller must either use `navigate` / `reloadCurrent` or be
 *    added here deliberately.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const THIS_FILE = path.relative(SRC, __filename);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8"),
}));
const isTest = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.startsWith("test/");

const filesMatching = (pattern: RegExp, include: (rel: string) => boolean) =>
  FILES.filter(({ rel, text }) => include(rel) && rel !== THIS_FILE && pattern.test(text))
    .map(({ rel }) => rel)
    .sort();

describe("place model invariants", () => {
  it("has no legacy view state left anywhere (tests included)", () => {
    expect(
      filesMatching(
        /\bcurrentView\b|isViewingGlobalStats|setViewingGlobalStats|setAnalyticsCurrentView/,
        () => true
      )
    ).toEqual([]);
  });

  /** Primitive → files allowed to call it (app source only). */
  const ALLOWED: Record<string, Record<string, string>> = {
    selectSession: {
      "store/slices/messageSlice.ts": "reloadCurrent, subagent drill-down",
      "store/slices/navigationSlice.ts": "navigate",
    },
    selectProject: {
      "store/slices/navigationSlice.ts": "navigate",
    },
    clearProjectSelection: {
      "store/slices/projectSlice.ts": "refresh fallback when the open project vanished",
      "store/slices/navigationSlice.ts": "navigate({ project: null })",
    },
    setSelectedSession: {
      "store/slices/messageSlice.ts": "selectSession",
    },
  };

  it.each(Object.keys(ALLOWED))("only the store calls %s()", (primitive) => {
    const callers = filesMatching(
      new RegExp(`\\b${primitive}\\s*\\(`),
      (rel) => !isTest(rel)
    );
    expect(callers).toEqual(Object.keys(ALLOWED[primitive]!).sort());
  });
});
