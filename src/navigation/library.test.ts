import { describe, expect, it } from "vitest";
import type { ClaudeProject, ClaudeSession } from "@/types";
import {
  RECENT_LIMIT,
  RECENT_STORAGE_KEY,
  favoritesMissingRef,
  favoritesOf,
  findProjectForSessionPath,
  loadRecent,
  parseRecent,
  pushRecent,
  recentEntryOf,
  saveRecent,
  type RecentEntry,
} from "./library";

const session = (id: string, file = `/p/a/${id}.jsonl`): ClaudeSession =>
  ({
    session_id: id,
    actual_session_id: id,
    file_path: file,
    project_name: "a",
    message_count: 1,
    first_message_time: "",
    last_message_time: "",
    last_modified: "",
    has_tool_use: false,
    has_errors: false,
    provider: "claude",
    summary: `title ${id}`,
  }) as ClaudeSession;

const project = (path: string, provider = "claude"): ClaudeProject => ({
  name: path.split("/").pop() ?? path,
  path,
  actual_path: `/home${path}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider,
});

describe("recent sessions", () => {
  it("puts the opened session first and moves a re-opened one up", () => {
    let list: RecentEntry[] = [];
    list = pushRecent(list, recentEntryOf(session("s1"), 1));
    list = pushRecent(list, recentEntryOf(session("s2"), 2));
    list = pushRecent(list, recentEntryOf(session("s1"), 3));
    expect(list.map((e) => e.ref.sessionId)).toEqual(["s1", "s2"]);
    expect(list[0]?.openedAt).toBe(3);
  });

  it("keeps at most twelve", () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 20; i += 1) list = pushRecent(list, recentEntryOf(session(`s${i}`), i));
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]?.ref.sessionId).toBe("s19");
  });

  it("drops malformed stored entries instead of throwing", () => {
    const good = recentEntryOf(session("ok"), 5);
    expect(
      parseRecent([
        null,
        { ref: { provider: "claude", filePath: "", sessionId: "x" }, openedAt: 1 },
        { ref: good.ref },
        "nope",
        good,
        good,
      ]),
    ).toEqual([good]);
    expect(parseRecent({ not: "a list" })).toEqual([]);
  });

  it("round-trips through storage and survives broken JSON", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const list = [recentEntryOf(session("s1"), 1)];
    saveRecent(list, storage);
    expect(loadRecent(storage)).toEqual(list);
    store.set(RECENT_STORAGE_KEY, "{broken");
    expect(loadRecent(storage)).toEqual([]);
  });
});

describe("favourites", () => {
  const metadata = {
    sessions: {
      legacy: { starred: true },
      withRef: {
        starred: true,
        customName: "Named",
        ref: { provider: "claude", filePath: "/p/a/withRef.jsonl", sessionId: "withRef" },
      },
      unstarred: { customName: "x" },
    },
  };

  it("lists starred sessions, with a ref first and legacy stars last", () => {
    expect(favoritesOf(metadata)).toEqual([
      {
        sessionId: "withRef",
        customName: "Named",
        ref: { provider: "claude", filePath: "/p/a/withRef.jsonl", sessionId: "withRef" },
      },
      { sessionId: "legacy", ref: null },
    ]);
  });

  it("finds the loaded sessions whose star still lacks a ref", () => {
    const loaded = [session("legacy"), session("withRef"), session("unstarred")];
    expect(favoritesMissingRef(metadata, loaded).map((s) => s.session_id)).toEqual(["legacy"]);
  });
});

describe("findProjectForSessionPath", () => {
  const projects = [project("/a/proj2"), project("/a/proj"), project("/a/proj", "codex")];

  it("matches on a path-segment boundary", () => {
    expect(findProjectForSessionPath(projects, "/a/proj/s.jsonl")?.path).toBe("/a/proj");
    expect(findProjectForSessionPath(projects, "/a/proj2/s.jsonl")?.path).toBe("/a/proj2");
    expect(findProjectForSessionPath(projects, "/a/projX/s.jsonl")).toBeUndefined();
  });

  it("prefers the session's provider", () => {
    expect(findProjectForSessionPath(projects, "/a/proj/s.jsonl", "codex")?.provider).toBe("codex");
  });
});
