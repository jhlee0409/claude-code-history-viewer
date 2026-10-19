import { describe, expect, it } from "vitest";
import {
  blankDocument,
  cycledId,
  documentFromLive,
  enforceTabCap,
  idAtPosition,
  MAX_TABS,
  neighbourAfterClose,
  parseStoredTabs,
  serializeTabs,
  subagentSessionOf,
  TABS_STORAGE_VERSION,
  type TabDocument,
} from "./documents";
import type { ClaudeProject, ClaudeSession } from "@/types";

const P: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
};
const S: ClaudeSession = {
  session_id: "s1",
  actual_session_id: "s1",
  file_path: "/p/alpha/s1.jsonl",
  project_name: "alpha",
  message_count: 3,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  summary: "First session",
  provider: "claude",
};

const doc = (id: string, lastActiveAt = 1): TabDocument => ({ ...blankDocument(id, lastActiveAt) });
const ids = (docs: readonly TabDocument[]) => docs.map((d) => d.id);

describe("tab list operations", () => {
  it("closing a tab moves to its right neighbour, else its left one", () => {
    const docs = [doc("a"), doc("b"), doc("c")];
    expect(neighbourAfterClose(docs, "b")).toBe("c");
    expect(neighbourAfterClose(docs, "c")).toBe("b");
    expect(neighbourAfterClose([doc("a")], "a")).toBeNull();
  });

  it(`keeps at most ${MAX_TABS} tabs, closing the inactive one used longest ago`, () => {
    const docs = Array.from({ length: MAX_TABS + 1 }, (_, i) => doc(`d${i}`, 100 + i));
    // The active tab is the oldest: it still stays.
    const capped = enforceTabCap({ documents: docs, activeId: "d0" });
    expect(capped.documents).toHaveLength(MAX_TABS);
    expect(ids(capped.documents)).toContain("d0");
    expect(ids(capped.documents)).not.toContain("d1");
  });

  it("cycles with wrap-around and picks ⌘1-8 by position, ⌘9 as the last", () => {
    const docs = [doc("a"), doc("b"), doc("c")];
    expect(cycledId({ documents: docs, activeId: "c" }, 1)).toBe("a");
    expect(cycledId({ documents: docs, activeId: "a" }, -1)).toBe("c");
    expect(cycledId({ documents: [doc("a")], activeId: "a" }, 1)).toBeNull();
    expect(idAtPosition(docs.map((d) => d.id), 2)).toBe("b");
    expect(idAtPosition(docs.map((d) => d.id), 5)).toBeNull();
    expect(idAtPosition(docs.map((d) => d.id), 9)).toBe("c");
  });
});

describe("documentFromLive", () => {
  it("takes the place, subagent path, anchor and history from the live store", () => {
    const sub = subagentSessionOf(
      { provider: "claude", filePath: "/p/alpha/s1/subagents/agent-x.jsonl", sessionId: "/p/alpha/s1/subagents/agent-x.jsonl", actualSessionId: "x" },
      S,
      "Sub task",
    );
    const live = documentFromLive(
      doc("a"),
      {
        view: "conversation",
        selectedProject: P,
        selectedSession: sub,
        parentSessionStack: [S],
        targetMessageUuid: null,
        placeHistory: { back: [], forward: [] },
      },
      { messageUuid: "m9", offset: -12 },
    );
    expect(live.project).toEqual({ provider: "claude", path: P.path });
    expect(live.session?.filePath).toBe(sub.file_path);
    expect(live.subagentStack.map((r) => r.filePath)).toEqual([S.file_path]);
    expect(live.subagentStack[0]?.projectPath).toBe(P.path);
    expect(live.anchor).toEqual({ messageUuid: "m9", offset: -12 });
    expect(live.title).toBe("Sub task");
    expect(live.live?.parentStack).toEqual([S]);
  });
});

describe("tabs.v2 storage", () => {
  const stored = (): TabDocument => ({
    ...doc("a", 5),
    view: "conversation",
    project: { provider: "claude", path: P.path },
    session: { provider: "claude", filePath: S.file_path, sessionId: "s1", projectPath: P.path },
    anchor: { messageUuid: "m1", offset: 4 },
    title: "First session",
    projectName: "alpha",
    targetMessageUuid: "transient",
    history: {
      back: [{ view: "analytics", analyticsTab: "tokens", project: P, session: S, messageId: null }],
      forward: [],
    },
    live: { project: P, session: S, parentStack: [] },
  });

  it("round-trips a tab, without live objects or the explicit target", () => {
    const parsed = parseStoredTabs(serializeTabs({ documents: [stored(), doc("b", 3)], activeId: "a" }));
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const [a] = parsed.tabs.documents;
    expect(parsed.tabs.activeId).toBe("a");
    expect(a?.session?.filePath).toBe(S.file_path);
    expect(a?.anchor).toEqual({ messageUuid: "m1", offset: 4 });
    expect(a?.history.back).toHaveLength(1);
    expect(a?.history.back[0]?.analyticsTab).toBe("tokens");
    expect(a?.live).toBeUndefined();
    expect(a?.targetMessageUuid).toBeNull();
    expect(parsed.tabs.dropped).toBe(0);
  });

  it.each([
    ["not JSON", "{oops"],
    ["another version", JSON.stringify({ version: 99, activeId: "a", documents: [] })],
    ["not an object", "[1,2]"],
    ["no valid tab", JSON.stringify({ version: TABS_STORAGE_VERSION, activeId: "a", documents: [{ id: 3 }] })],
  ])("%s is corrupt (start with one empty tab)", (_label, raw) => {
    expect(parseStoredTabs(raw).kind).toBe("corrupt");
  });

  it("keeps each tab's analytics sub-tab (T9b) and repairs a missing or unknown one to the overview", () => {
    const onTokens = { ...stored(), view: "analytics" as const, analyticsTab: "tokens" as const };
    const parsed = parseStoredTabs(serializeTabs({ documents: [onTokens], activeId: "a" }));
    expect(parsed.kind === "ok" && parsed.tabs.documents[0]?.analyticsTab).toBe("tokens");
    expect(JSON.parse(serializeTabs({ documents: [onTokens], activeId: "a" })).version).toBe(2);

    const raw = JSON.parse(serializeTabs({ documents: [onTokens], activeId: "a" }));
    raw.documents[0].analyticsTab = "bogus";
    const repaired = parseStoredTabs(JSON.stringify(raw));
    expect(repaired.kind === "ok" && repaired.tabs.documents[0]?.analyticsTab).toBe("overview");
  });

  it("a stored token stats screen is not a view any more: that tab is dropped (the migration moved it)", () => {
    const raw = JSON.parse(serializeTabs({ documents: [stored(), doc("b", 3)], activeId: "a" }));
    raw.documents[0].view = "tokenStats";
    const parsed = parseStoredTabs(JSON.stringify(raw));
    expect(parsed.kind === "ok" && parsed.tabs.dropped).toBe(1);
  });

  it("nothing stored is not an error", () => {
    expect(parseStoredTabs(null).kind).toBe("none");
  });

  it("drops invalid tabs one by one, counts them and repairs the active id", () => {
    const good = JSON.parse(serializeTabs({ documents: [stored()], activeId: "a" })).documents[0];
    const raw = JSON.stringify({
      version: TABS_STORAGE_VERSION,
      activeId: "missing",
      documents: [
        good,
        { ...good, id: "bad-view", view: "nope" },
        { ...good, id: "bad-time", lastActiveAt: "yesterday" },
        { ...good, id: "session-without-project", project: null },
        { ...good, id: "bad-stack", subagentStack: [{ provider: "claude" }] },
        { ...good, id: "a" }, // duplicate id
        { ...good, id: "bad-anchor", anchor: { messageUuid: "", offset: "x" } },
        "__proto__",
      ],
    });
    const parsed = parseStoredTabs(raw);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    expect(ids(parsed.tabs.documents)).toEqual(["a", "bad-anchor"]);
    // A malformed anchor is dropped, not the tab.
    expect(parsed.tabs.documents[1]?.anchor).toBeNull();
    expect(parsed.tabs.dropped).toBe(6);
    expect(parsed.tabs.activeId).toBe("a");
  });

  it("keeps the most recently used tabs when more than the cap were stored", () => {
    const docs = Array.from({ length: MAX_TABS + 3 }, (_, i) => doc(`d${i}`, 10 + i));
    const parsed = parseStoredTabs(serializeTabs({ documents: docs, activeId: "d0" }));
    if (parsed.kind !== "ok") throw new Error(parsed.kind);
    expect(parsed.tabs.documents).toHaveLength(MAX_TABS);
    expect(ids(parsed.tabs.documents)).toContain("d0");
    expect(ids(parsed.tabs.documents)).not.toContain("d1");
    expect(parsed.tabs.dropped).toBe(3);
  });
});
