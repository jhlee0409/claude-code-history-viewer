/**
 * Conversation tabs (plan §4.3, T8 VERIFY) on the fully wired store:
 * switching, restoring and closing tabs against a fake backend whose
 * requests can be held, so each race in the plan's list is played out:
 *
 * - A→B→A with a stale older-page request pending;
 * - a watcher event during the startup restore;
 * - subagent → other tab → subagent (and a restored subagent tab);
 * - an explicit target and a saved anchor both present;
 * - a CLI hint during the restore, and a second launch with a session open;
 * - closing the active tab while it loads;
 * - a tab whose session was deleted or whose provider is off;
 * - the tab cap and the last tab;
 * - a corrupted `tabs.v1`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { ClaudeMessage, ClaudeProject, ClaudeSession, SubagentSession } from "@/types";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api", () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useAppStore } from "@/store/useAppStore";
import { initialDocumentState } from "@/store/slices/documentSlice";
import {
  activateTab,
  closeTab,
  currentDocuments,
  newTab,
  openHintInTab,
  openInNewTab,
  persistTabs,
  reportStoredTabsProblems,
  restoreActiveTab,
  type TabScreens,
} from "@/navigation/tabs";
import {
  MAX_TABS,
  serializeTabs,
  TABS_STORAGE_KEY,
  blankDocument,
  type TabDocument,
} from "@/navigation/documents";
import { registerScrollAnchorSource } from "@/navigation/scrollAnchor";

const project = (name: string, provider = "claude"): ClaudeProject => ({
  name,
  path: provider === "claude" ? `/p/${name}` : `${provider}:///w/${name}`,
  actual_path: `/home/${name}`,
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: provider as ClaudeProject["provider"],
});
const sessionOf = (p: ClaudeProject, id: string, summary = `Session ${id}`): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `/p/${p.name}/${id}.jsonl`,
  project_name: p.name,
  message_count: 1,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
  summary,
  provider: p.provider,
});

const A = project("a");
const B = project("b");
const A1 = sessionOf(A, "a1");
const A2 = sessionOf(A, "a2");
const B1 = sessionOf(B, "b1");
const LISTS: Record<string, ClaudeSession[]> = { [A.path]: [A1, A2], [B.path]: [B1] };
const SUBAGENT: SubagentSession = {
  agent_id: "agent-x",
  file_path: "/p/a/a1/subagents/agent-x.jsonl",
  message_count: 4,
  file_size: 1,
  first_message_time: null,
  last_message_time: null,
  summary: "Sub task",
  tool_use_id: null,
  workflow_run_id: null,
};

/** Messages per session file; 300 means a window of 200 with an older page. */
const TOTALS: Record<string, number> = {
  [A1.file_path]: 300,
  [A2.file_path]: 20,
  [B1.file_path]: 20,
  [SUBAGENT.file_path]: 4,
};
const message = (path: string, i: number) =>
  ({ uuid: `${path}#${i}`, type: "user", timestamp: "", message: { role: "user", content: "x" } }) as unknown as ClaudeMessage;

/** Held requests: `hold(key)` holds every request with that key until `release(key)`. */
const holds = new Map<string, Array<() => void>>();
const hold = (key: string) => holds.set(key, []);
const release = (key: string) => {
  const waiting = holds.get(key) ?? [];
  holds.delete(key);
  waiting.forEach((resume) => resume());
};
const held = async (key: string) => {
  const queue = holds.get(key);
  if (queue) await new Promise<void>((resume) => queue.push(resume));
};

const messageCalls = () =>
  apiMock.mock.calls
    .filter(([command]) => command === "load_provider_messages_paginated")
    .map(([, args]) => args as { sessionPath: string; offset: number; excludeSidechain: boolean });

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
const screens: TabScreens = { openView: vi.fn(async () => undefined) };

beforeEach(() => {
  holds.clear();
  localStorage.clear();
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    switch (command) {
      case "load_provider_sessions_page": {
        const sessions = LISTS[String(args.projectPath)] ?? [];
        return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
      }
      case "load_project_sessions":
      case "load_provider_sessions":
        await held(`list:${String(args.projectPath)}`);
        return LISTS[String(args.projectPath)] ?? [];
      case "load_provider_messages_paginated": {
        const path = String(args.sessionPath);
        const offset = Number(args.offset);
        await held(`page:${path}@${offset}`);
        await held(`page:${path}`);
        const total = TOTALS[path] ?? 0;
        const limit = Number(args.limit);
        const end = total - offset;
        const start = Math.max(0, end - limit);
        const messages = Array.from({ length: Math.max(0, end - start) }, (_, k) => message(path, start + k));
        const next = offset + messages.length;
        return { messages, total_count: total, has_more: next < total, next_offset: next };
      }
      case "get_session_subagents":
        return [];
      case "get_provider_message_offset": {
        // Messages are `${path}#${i}`; the offset counts from the newest end.
        const uuid = String(args.messageUuid);
        await held(`offset:${uuid}`);
        const [path, index] = uuid.split("#");
        const total = TOTALS[path!] ?? 0;
        return index === undefined ? null : total - 1 - Number(index);
      }
      default:
        return null;
    }
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useAppStore.setState(pristine, true);
  useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
  window.history.replaceState({}, "", "/");
  Object.values(toastMock).forEach((fn) => fn.mockClear());
});

afterEach(() => vi.restoreAllMocks());

const open = (p: ClaudeProject, s: ClaudeSession) => state().navigate({ view: "conversation", project: p, session: s });
const tabOf = (id: string) => currentDocuments().find((d) => d.id === id);
const activeId = () => state().activeDocumentId;
const where = () => [activeId(), state().selectedProject?.path ?? null, state().selectedSession?.file_path ?? null];

/** Tabs as `tabs.v1` would hold them, loaded into the store as at startup. */
function startWithStoredTabs(documents: TabDocument[], activeIdStored: string) {
  localStorage.setItem(TABS_STORAGE_KEY, serializeTabs({ documents, activeId: activeIdStored }));
  useAppStore.setState(initialDocumentState());
}

const storedTab = (id: string, p: ClaudeProject, s: ClaudeSession | null, extra: Partial<TabDocument> = {}): TabDocument => ({
  ...blankDocument(id, 10),
  view: "conversation",
  project: { provider: p.provider ?? "claude", path: p.path },
  session: s
    ? { provider: s.provider ?? "claude", filePath: s.file_path, sessionId: s.session_id, projectPath: p.path }
    : null,
  title: s?.summary ?? null,
  projectName: p.name,
  ...extra,
});

describe("switching tabs", () => {
  it("A→B→A: an older page requested for A before the switch does not land in A's reopened window", async () => {
    await open(A, A1);
    const tab1 = activeId();
    expect(state().messages).toHaveLength(200);

    hold(`page:${A1.file_path}@200`);
    const stalePage = state().loadMoreMessages();

    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();
    expect(tab2).not.toBe(tab1);
    expect(where()).toEqual([tab2, B.path, B1.file_path]);

    await activateTab(tab1, screens);
    expect(where()).toEqual([tab1, A.path, A1.file_path]);
    const reopened = state().messages.map((m) => m.uuid);

    release(`page:${A1.file_path}@200`);
    await stalePage;

    expect(state().messages.map((m) => m.uuid)).toEqual(reopened);
    expect(state().pagination.currentOffset).toBe(200);
    expect(state().pagination.isLoadingMore).toBe(false);
    // Tab 2 kept its own place.
    expect(tabOf(tab2)?.session?.filePath).toBe(B1.file_path);
  });

  it("subagent → other tab → subagent: the parent path and the sidechain filter come back", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await state().navigateToSubagent(SUBAGENT);
    expect(state().parentSessionStack.map((s) => s.file_path)).toEqual([A1.file_path]);

    await openInNewTab(() => open(B, B1));
    expect(state().parentSessionStack).toEqual([]);

    apiMock.mockClear();
    await activateTab(tab1, screens);

    expect(state().selectedSession?.file_path).toBe(SUBAGENT.file_path);
    expect(state().parentSessionStack.map((s) => s.file_path)).toEqual([A1.file_path]);
    const loads = messageCalls().filter((c) => c.sessionPath === SUBAGENT.file_path);
    expect(loads.length).toBeGreaterThan(0);
    // A subagent transcript is all sidechain: it is never filtered out.
    expect(loads.every((c) => c.excludeSidechain === false)).toBe(true);
  });

  it("a restored subagent tab rebuilds its parent path from storage", async () => {
    await open(A, A1);
    await state().navigateToSubagent(SUBAGENT);
    persistTabs();

    useAppStore.setState(pristine, true);
    useAppStore.setState({ claudePath: "/home/.claude", projects: [A, B] });
    useAppStore.setState(initialDocumentState());
    apiMock.mockClear();
    await restoreActiveTab(screens);

    expect(state().selectedSession?.file_path).toBe(SUBAGENT.file_path);
    expect(state().selectedSession?.summary).toBe("Sub task");
    expect(state().parentSessionStack.map((s) => s.file_path)).toEqual([A1.file_path]);
    expect(messageCalls().filter((c) => c.sessionPath === SUBAGENT.file_path).every((c) => !c.excludeSidechain)).toBe(true);
  });

  it("an explicit target outranks the saved anchor; the anchor alone is restored otherwise", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();
    const withBoth = (id: string, target: string | null) =>
      useAppStore.setState({
        documents: currentDocuments().map((d) =>
          d.id === id ? { ...d, anchor: { messageUuid: `${A1.file_path}#150`, offset: 8 }, targetMessageUuid: target } : d,
        ),
      });

    withBoth(tab1, `${A1.file_path}#120`);
    await activateTab(tab1, screens);
    expect(state().targetMessageUuid).toBe(`${A1.file_path}#120`);
    expect(state().pendingAnchor).toBeNull();

    await activateTab(tab2, screens);
    withBoth(tab1, null);
    await activateTab(tab1, screens);
    expect(state().targetMessageUuid).toBeNull();
    expect(state().pendingAnchor).toEqual({
      documentId: tab1,
      sessionPath: A1.file_path,
      anchor: { messageUuid: `${A1.file_path}#150`, offset: 8 },
    });

    // A search result arriving now wins over the anchor still pending.
    state().navigateToMessage(`${A1.file_path}#10`);
    expect(state().pendingAnchor).toBeNull();
  });

  it("a late 'target not found' from another tab does not clear this tab's target", async () => {
    await open(A, A1);
    state().navigateToMessage("m-old");
    hold("offset:m-old");
    const late = state().lookUpTargetMessage();
    await openInNewTab(() => open(B, B1));
    state().navigateToMessage("m-new");

    release("offset:m-old");
    await expect(late).resolves.toBe(false);
    expect(state().targetMessageUuid).toBe("m-new");
    // The lookup for the current target clears it when it is not there.
    await expect(state().lookUpTargetMessage()).resolves.toBe(false);
    expect(state().targetMessageUuid).toBeNull();
  });

  it("A→B→A: the old lookup of A's target does not clear the same target restored in A (review #4)", async () => {
    await open(A, A1);
    const tab1 = activeId();
    const target = `${A1.file_path}#10`; // in the older page
    state().navigateToMessage(target);
    hold(`offset:${target}`);
    const stale = state().lookUpTargetMessage();

    await openInNewTab(() => open(B, B1));
    await activateTab(tab1, screens);
    // Same tab, same uuid: only the request that set it differs.
    expect(where()).toEqual([tab1, A.path, A1.file_path]);
    expect(state().targetMessageUuid).toBe(target);

    release(`offset:${target}`);
    // Superseded: A's window was reloaded on reopening.
    await expect(stale).resolves.toBe(false);
    expect(state().targetMessageUuid).toBe(target);

    // The restored target's own lookup pages it in.
    await expect(state().lookUpTargetMessage()).resolves.toBe(true);
    expect(state().targetMessageUuid).toBe(target);
    expect(state().messages.some((m) => m.uuid === target)).toBe(true);
  });

  it("saves the scroll anchor the viewer reports when the tab is left", async () => {
    await open(A, A1);
    const tab1 = activeId();
    const unregister = registerScrollAnchorSource({
      sessionPath: A1.file_path,
      read: () => ({ messageUuid: `${A1.file_path}#42`, offset: -6 }),
    });
    try {
      await openInNewTab(() => open(B, B1));
    } finally {
      unregister();
    }
    expect(tabOf(tab1)?.anchor).toEqual({ messageUuid: `${A1.file_path}#42`, offset: -6 });
  });
});

describe("superseded activations write nothing (review #1)", () => {
  it("an activation superseded while its screen's data loads resolves false; the newer tab stays", async () => {
    await open(A, A1);
    await state().navigate({ view: "analytics" });
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();

    let releaseScreen = () => {};
    const heldScreens: TabScreens = {
      openView: (view) => {
        // A screen loader enters its screen with a navigation of its own
        // before its first await (`enterScreen`).
        void state().navigate({ view });
        return new Promise<void>((resolve) => (releaseScreen = resolve));
      },
    };
    const stale = activateTab(tab1, heldScreens);
    await waitFor(() => expect(state().view).toBe("analytics"));
    await activateTab(tab2, screens);
    releaseScreen();

    await expect(stale).resolves.toBe(false);
    expect(where()).toEqual([tab2, B.path, B1.file_path]);
  });

  it("an activation whose screen loader navigates is still the owner when nothing else moved", async () => {
    await open(A, A1);
    await state().navigate({ view: "analytics" });
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const enteringScreens: TabScreens = { openView: (view) => state().navigate({ view }) };
    await expect(activateTab(tab1, enteringScreens)).resolves.toBe(true);
    expect(state().view).toBe("analytics");
  });
});

describe("closing tabs", () => {
  it("closing the active tab while it loads: the neighbour opens and the abandoned load lands nowhere", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();

    hold(`page:${A1.file_path}`);
    const switching = activateTab(tab1, screens);
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(A1.file_path));
    expect(state().isLoadingMessages).toBe(true);

    await closeTab(tab1, screens);
    release(`page:${A1.file_path}`);
    await expect(switching).resolves.toBe(false);

    expect(where()).toEqual([tab2, B.path, B1.file_path]);
    expect(state().documents.map((d) => d.id)).toEqual([tab2]);
    expect(state().messages.every((m) => m.uuid.startsWith(B1.file_path))).toBe(true);
    expect(state().isLoadingMessages).toBe(false);
  });

  it("closing the only tab leaves one empty tab", async () => {
    await open(A, A1);
    const only = activeId();
    await closeTab(only, screens);
    expect(state().documents).toHaveLength(1);
    expect(activeId()).not.toBe(only);
    expect(state().selectedProject).toBeNull();
    expect(state().selectedSession).toBeNull();
  });

  it(`keeps at most ${MAX_TABS} tabs: one more closes the inactive tab used longest ago`, async () => {
    const first = activeId();
    for (let i = 1; i < MAX_TABS; i += 1) await newTab();
    expect(state().documents).toHaveLength(MAX_TABS);
    const second = state().documents[1]!.id;
    // The first tab is used again, so the second is now the oldest.
    await activateTab(first, screens);

    await newTab();
    const ids = state().documents.map((d) => d.id);
    expect(ids).toHaveLength(MAX_TABS);
    expect(ids).toContain(first);
    expect(ids).not.toContain(second);
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });
});

describe("restoring tabs at startup", () => {
  it("opens the stored active tab with its anchor, after the hint step found none", async () => {
    startWithStoredTabs(
      [
        storedTab("t-a", A, A1, { anchor: { messageUuid: `${A1.file_path}#130`, offset: 3 } }),
        storedTab("t-b", B, B1),
      ],
      "t-a",
    );
    expect(state().tabsRestorePending).toBe(true);
    await restoreActiveTab(screens);
    expect(where()).toEqual(["t-a", A.path, A1.file_path]);
    expect(state().pendingAnchor?.anchor).toEqual({ messageUuid: `${A1.file_path}#130`, offset: 3 });
    // The other tab stays a snapshot until it is opened.
    expect(tabOf("t-b")?.session?.filePath).toBe(B1.file_path);
  });

  it("a watcher event during the restore reloads in place and does not move the user", async () => {
    startWithStoredTabs([storedTab("t-a", A, A1)], "t-a");
    hold(`page:${A1.file_path}`);
    const restoring = restoreActiveTab(screens);
    await waitFor(() => expect(state().selectedSession?.file_path).toBe(A1.file_path));
    const epoch = state().navigationEpoch;

    const watcher = state().reloadCurrent("watcher");
    expect(state().navigationEpoch).toBe(epoch);
    release(`page:${A1.file_path}`);
    await watcher;
    await expect(restoring).resolves.toBe(true);

    expect(where()).toEqual(["t-a", A.path, A1.file_path]);
    expect(state().hydratedDocumentId).toBe("t-a");
    expect(state().messages).toHaveLength(200);
    expect(state().isLoadingMessages).toBe(false);
  });

  it("a CLI hint during the restore wins: its session opens in a tab of its own", async () => {
    startWithStoredTabs([storedTab("t-a", A, A1)], "t-a");
    hold(`list:${A.path}`);
    const restoring = restoreActiveTab(screens);

    const epoch = state().beginNavigation();
    await openHintInTab({ project: B, session: B1 }, { epoch, messageId: null });
    release(`list:${A.path}`);
    await expect(restoring).resolves.toBe(false);

    expect(activeId()).not.toBe("t-a");
    expect(where()).toEqual([activeId(), B.path, B1.file_path]);
    // The restored tab keeps its saved place for later.
    expect(tabOf("t-a")?.session?.filePath).toBe(A1.file_path);
  });

  it("a hint naming the restored active tab's session reopens that tab, with its anchor (WebUI reload)", async () => {
    startWithStoredTabs(
      [storedTab("t-a", A, A1, { anchor: { messageUuid: `${A1.file_path}#130`, offset: 3 } }), storedTab("t-b", B, B1)],
      "t-a",
    );
    await openHintInTab({ project: A, session: A1 }, { epoch: state().beginNavigation(), messageId: null });
    expect(state().documents.map((d) => d.id)).toEqual(["t-a", "t-b"]);
    expect(where()).toEqual(["t-a", A.path, A1.file_path]);
    expect(state().pendingAnchor?.anchor).toEqual({ messageUuid: `${A1.file_path}#130`, offset: 3 });
  });

  it("a second launch with a session open: the hint gets a new tab, and reuses a tab that shows it", async () => {
    await open(A, A1);
    const tab1 = activeId();

    await openHintInTab({ project: B, session: B1 }, { epoch: state().beginNavigation(), messageId: "b-msg" });
    const tab2 = activeId();
    expect(tab2).not.toBe(tab1);
    expect(where()).toEqual([tab2, B.path, B1.file_path]);
    expect(state().targetMessageUuid).toBe("b-msg");
    expect(tabOf(tab1)?.session?.filePath).toBe(A1.file_path);

    await openHintInTab({ project: A, session: A1 }, { epoch: state().beginNavigation(), messageId: null });
    expect(where()).toEqual([tab1, A.path, A1.file_path]);
    expect(state().documents).toHaveLength(2);
  });

  it("a tab whose session was deleted shows the in-tab state, without the app error screen", async () => {
    const gone = sessionOf(A, "gone");
    startWithStoredTabs([storedTab("t-gone", A, gone)], "t-gone");
    await restoreActiveTab(screens);

    expect(tabOf("t-gone")?.unavailable).toBe("session");
    expect(state().error).toBeNull();
    expect(state().selectedProject?.path).toBe(A.path);
    expect(state().selectedSession).toBeNull();
    // The tab keeps naming what it had.
    expect(tabOf("t-gone")?.session?.filePath).toBe(gone.file_path);
    // Moving on inside the tab makes it an ordinary tab again.
    await open(A, A2);
    expect(tabOf("t-gone")?.unavailable).toBeNull();
  });

  it("a tab whose provider is off (project not scanned) shows the in-tab state", async () => {
    const codex = project("w", "codex");
    startWithStoredTabs([storedTab("t-codex", codex, sessionOf(codex, "c1"))], "t-codex");
    await restoreActiveTab(screens);

    expect(tabOf("t-codex")?.unavailable).toBe("project");
    expect(state().selectedProject).toBeNull();
    expect(state().error).toBeNull();
  });

  it("a corrupted tabs.v1 starts with one empty tab and says so once", () => {
    localStorage.setItem(TABS_STORAGE_KEY, "{not json");
    useAppStore.setState(initialDocumentState());
    expect(state().documents).toHaveLength(1);
    expect(state().tabsRestorePending).toBe(false);

    reportStoredTabsProblems();
    reportStoredTabsProblems();
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it("stores what each tab needs to reopen: refs with the owning project, no live objects", async () => {
    await open(A, A1);
    await openInNewTab(() => open(B, B1));
    persistTabs();
    const stored = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY)!);
    expect(stored.version).toBe(1);
    expect(stored.activeId).toBe(activeId());
    expect(stored.documents.map((d: TabDocument) => d.session?.projectPath)).toEqual([A.path, B.path]);
    expect(JSON.stringify(stored)).not.toContain('"live"');
  });
});
