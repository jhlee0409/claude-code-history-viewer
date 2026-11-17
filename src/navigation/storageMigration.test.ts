/**
 * The one-time UI storage migration of T9b: `tabs.v1` → `tabs.v2` (token
 * stats becomes the analytics "tokens" sub-tab, in every tab and in every
 * back/forward entry) and the recent-edits dock's keys go away.
 */
import { describe, expect, it } from "vitest";
import { parseStoredTabs, TABS_STORAGE_KEY } from "./documents";
import {
  LEGACY_TABS_STORAGE_KEY,
  migrateTabsV1,
  REMOVED_DOCK_KEYS,
  runUiStorageMigrations,
  UI_STORAGE_VERSION,
  UI_STORAGE_VERSION_KEY,
} from "./storageMigration";

/** A Storage over a plain map, recording every write. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      data.set(key, value);
    },
    removeItem: (key: string) => {
      writes.push(`-${key}`);
      data.delete(key);
    },
  };
}

const PROJECT_OBJECT = { name: "alpha", path: "/p/alpha", provider: "claude" };
const SESSION_OBJECT = { session_id: "s1", file_path: "/p/alpha/s1.jsonl", provider: "claude" };

/** `tabs.v1` exactly as T8 wrote it: a token stats tab with history through token stats. */
const V1 = {
  version: 1,
  activeId: "t-tokens",
  documents: [
    {
      id: "t-tokens",
      view: "tokenStats",
      project: { provider: "claude", path: "/p/alpha" },
      session: { provider: "claude", filePath: "/p/alpha/s1.jsonl", sessionId: "s1", projectPath: "/p/alpha" },
      subagentStack: [],
      anchor: null,
      title: "First session",
      projectName: "alpha",
      lastActiveAt: 1_700_000_000_000,
      history: {
        back: [
          { view: "conversation", project: PROJECT_OBJECT, session: SESSION_OBJECT, messageId: null },
          { view: "analytics", project: PROJECT_OBJECT, session: SESSION_OBJECT, messageId: null },
        ],
        forward: [{ view: "tokenStats", project: PROJECT_OBJECT, session: null, messageId: null }],
      },
    },
    {
      id: "t-analytics",
      view: "analytics",
      project: { provider: "claude", path: "/p/alpha" },
      session: null,
      subagentStack: [],
      anchor: null,
      title: null,
      projectName: "alpha",
      lastActiveAt: 1_699_000_000_000,
      history: { back: [], forward: [] },
    },
  ],
};

describe("migrateTabsV1", () => {
  it("turns a token stats tab into analytics on the tokens sub-tab", () => {
    const parsed = parseStoredTabs(migrateTabsV1(JSON.stringify(V1)));
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const [tokens, analytics] = parsed.tabs.documents;
    expect(tokens).toMatchObject({ id: "t-tokens", view: "analytics", analyticsTab: "tokens" });
    // Everything else of the tab is kept.
    expect(tokens!.session?.filePath).toBe("/p/alpha/s1.jsonl");
    expect(tokens!.title).toBe("First session");
    expect(parsed.tabs.activeId).toBe("t-tokens");
    // A plain analytics tab opens on the overview.
    expect(analytics).toMatchObject({ id: "t-analytics", view: "analytics", analyticsTab: "overview" });
    expect(parsed.tabs.dropped).toBe(0);
  });

  it("migrates back/forward history entries the same way", () => {
    const parsed = parseStoredTabs(migrateTabsV1(JSON.stringify(V1)));
    if (parsed.kind !== "ok") throw new Error("not ok");
    const { back, forward } = parsed.tabs.documents[0]!.history;
    expect(back.map((e) => [e.view, e.analyticsTab])).toEqual([
      ["conversation", "overview"],
      ["analytics", "overview"],
    ]);
    expect(forward.map((e) => [e.view, e.analyticsTab])).toEqual([["analytics", "tokens"]]);
  });

  it("leaves anything that is not tabs.v1 as it is, so reading it reports it once", () => {
    expect(migrateTabsV1("{not json")).toBe("{not json");
    const v3 = JSON.stringify({ ...V1, version: 3 });
    expect(migrateTabsV1(v3)).toBe(v3);
    expect(parseStoredTabs(migrateTabsV1("{not json")).kind).toBe("corrupt");
  });
});

describe("runUiStorageMigrations", () => {
  it("moves tabs.v1 to tabs.v2 and removes the old key", () => {
    const storage = memoryStorage({ [LEGACY_TABS_STORAGE_KEY]: JSON.stringify(V1) });
    runUiStorageMigrations(storage);
    expect(storage.data.has(LEGACY_TABS_STORAGE_KEY)).toBe(false);
    const parsed = parseStoredTabs(storage.data.get(TABS_STORAGE_KEY) ?? null);
    expect(parsed.kind === "ok" && parsed.tabs.documents[0]!.analyticsTab).toBe("tokens");
    expect(storage.data.get(UI_STORAGE_VERSION_KEY)).toBe(String(UI_STORAGE_VERSION));
  });

  it("deletes every key of the removed recent-edits dock", () => {
    const storage = memoryStorage({
      "recent-edits-mode": "docked",
      "recent-edits-dock-open": "true",
      "recent-edits-density-dock": "compact",
      "recent-edits-width": "400",
      "recent-edits-scope": "session",
    });
    runUiStorageMigrations(storage);
    for (const key of REMOVED_DOCK_KEYS) expect(storage.data.has(key), key).toBe(false);
    expect(REMOVED_DOCK_KEYS).toEqual(
      expect.arrayContaining(["recent-edits-mode", "recent-edits-dock-open", "recent-edits-density-dock", "recent-edits-width"]),
    );
    // Preferences the Edits screen still has stay.
    expect(storage.data.get("recent-edits-scope")).toBe("session");
  });

  it("keeps the page's row density as the Edits screen's density", () => {
    const storage = memoryStorage({ "recent-edits-density-page": "compact" });
    runUiStorageMigrations(storage);
    expect(storage.data.get("recent-edits-density")).toBe("compact");
    expect(storage.data.has("recent-edits-density-page")).toBe(false);
  });

  it("runs once: a later run changes nothing, even if old keys come back", () => {
    const storage = memoryStorage({ [LEGACY_TABS_STORAGE_KEY]: JSON.stringify(V1) });
    runUiStorageMigrations(storage);
    const migrated = storage.data.get(TABS_STORAGE_KEY);
    storage.writes.length = 0;
    // An older build running meanwhile writes tabs.v1 again: it is not
    // migrated over the newer tabs.
    storage.data.set(LEGACY_TABS_STORAGE_KEY, JSON.stringify({ ...V1, activeId: "t-analytics" }));
    runUiStorageMigrations(storage);
    expect(storage.writes).toEqual([]);
    expect(storage.data.get(TABS_STORAGE_KEY)).toBe(migrated);
  });

  it("never overwrites tabs.v2 that already exist", () => {
    const storage = memoryStorage({ [LEGACY_TABS_STORAGE_KEY]: JSON.stringify(V1), [TABS_STORAGE_KEY]: "kept" });
    runUiStorageMigrations(storage);
    expect(storage.data.get(TABS_STORAGE_KEY)).toBe("kept");
    expect(storage.data.has(LEGACY_TABS_STORAGE_KEY)).toBe(false);
  });

  it("is a no-op on a fresh install apart from recording the version", () => {
    const storage = memoryStorage();
    runUiStorageMigrations(storage);
    expect(storage.writes).toEqual([UI_STORAGE_VERSION_KEY]);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => runUiStorageMigrations(throwing)).not.toThrow();
  });
});
