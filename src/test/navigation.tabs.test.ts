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
 * - a tab whose project folder was deleted between scans;
 * - a per-document load failing (session list, screens, find): never the
 *   app's error screen, and the other tabs stay usable;
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
import {
  LEGACY_TABS_STORAGE_KEY,
  runUiStorageMigrations,
  UI_STORAGE_VERSION_KEY,
} from "@/navigation/storageMigration";
import { registerScrollAnchorSource } from "@/navigation/scrollAnchor";
import { fieldsOf } from "@/navigation/stateScope";
import { createEmptySearchState } from "@/store/slices/types";
import { loadProjectAnalytics, loadRecentEditsScreen, loadTokenStatsScreen, reloadBoard } from "@/navigation/screenData";

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

/** Session files deleted on disk: loading their messages fails. */
const deleted = new Set<string>();
/**
 * Project folders deleted on disk since the last scan: the project is still
 * listed, but its session list fails the way the backend reports it
 * (`load.rs` canonicalizes the folder), and so do its sessions' messages.
 */
const deletedProjects = new Set<string>();
const GONE = "Failed to resolve project_path: No such file or directory (os error 2)";
const projectGone = (projectPath: unknown) => {
  if (deletedProjects.has(String(projectPath))) throw new Error(GONE);
};
const underDeletedProject = (path: string) => [...deletedProjects].some((p) => path.startsWith(`${p}/`));
/**
 * Session lists failing for a reason other than a missing folder (a busy
 * file on Windows, a dropped WebUI connection), by project path.
 */
const listFailures = new Map<string, string>();
/** Commands that fail outright (a per-document loader's request). */
const failing = new Set<string>();

const messageCalls = () =>
  apiMock.mock.calls
    .filter(([command]) => command === "load_provider_messages_paginated")
    .map(([, args]) => args as { sessionPath: string; offset: number; excludeSidechain: boolean });

const pristine = useAppStore.getState();
const state = () => useAppStore.getState();
const screens: TabScreens = { openView: vi.fn(async () => undefined) };

beforeEach(() => {
  holds.clear();
  deleted.clear();
  deletedProjects.clear();
  listFailures.clear();
  failing.clear();
  localStorage.clear();
  apiMock.mockReset();
  apiMock.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (failing.has(command)) throw new Error(`${command} failed`);
    switch (command) {
      case "load_provider_sessions_page": {
        projectGone(args.projectPath);
        const listFailure = listFailures.get(String(args.projectPath));
        if (listFailure) throw new Error(listFailure);
        const sessions = LISTS[String(args.projectPath)] ?? [];
        return { sessions, total: sessions.length, nextOffset: sessions.length, hasMore: false };
      }
      case "load_project_sessions":
      case "load_provider_sessions":
        await held(`list:${String(args.projectPath)}`);
        projectGone(args.projectPath);
        return LISTS[String(args.projectPath)] ?? [];
      case "load_provider_messages_paginated": {
        const path = String(args.sessionPath);
        const offset = Number(args.offset);
        await held(`page:${path}@${offset}`);
        await held(`page:${path}`);
        if (deleted.has(path) || underDeletedProject(path)) {
          throw new Error(`Failed to open ${path}: No such file or directory (os error 2)`);
        }
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
      case "get_recent_edits":
        return { files: [], total_edits_count: 0, unique_files_count: 0, offset: 0, limit: 50, has_more: false };
      case "load_provider_messages": {
        const path = String(args.sessionPath);
        await held(`full:${path}`);
        return Array.from({ length: TOTALS[path] ?? 0 }, (_, i) => message(path, i));
      }
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

/** Store fields by name, for the stateScope behaviour tests. */
const pick = (fields: string[]) =>
  Object.fromEntries(fields.map((f) => [f, (state() as unknown as Record<string, unknown>)[f]]));
const comparable = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) => (v instanceof Map ? { map: [...v.entries()] } : v));
const same = (a: unknown, b: unknown) => comparable(a) === comparable(b);
/** `value` changed in a way that keeps its type: tab 1's own value. */
const tag = (value: unknown): unknown => {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") return `${value}~tab1`;
  if (value === null) return { tab1: true };
  if (Array.isArray(value)) return [...value, { tab1: true }];
  if (value instanceof Map) return new Map([...value.entries(), ["tab1", "tab1"]]);
  if (typeof value === "object") return { ...value, tab1: true };
  return value;
};
const tagged = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, tag(pick([f])[f])]));
/** What every `reset` field holds on a switch: its initial value; the find keeps its filter type. */
const resetValues = () => ({
  ...Object.fromEntries(fieldsOf("reset").map((f) => [f, (pristine as unknown as Record<string, unknown>)[f]])),
  sessionSearch: createEmptySearchState(state().sessionSearch.filterType),
});
/** Every `reset` field away from its reset value (a find, board hover, scroll report, sidebar selection). */
const setEveryResetField = (uuid: string) => {
  useAppStore.setState({
    sessionSearch: {
      ...state().sessionSearch,
      query: "q",
      currentMatchIndex: 0,
      matches: [{ messageUuid: uuid, messageIndex: 0, matchIndex: 0, matchCount: 1 }],
    },
    boardHoverSession: A2,
    visibleMessageUuid: uuid,
    activeSessionNearBottom: !pristine.activeSessionNearBottom,
    isSessionSelectionMode: true,
    sessionSelectionIds: [A2.session_id],
    sessionSelectionAnchor: A2.session_id,
  });
};

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

describe("a tab's transcript state: search and capture (review #5)", () => {
  const capture = () => ({
    isCaptureMode: state().isCaptureMode,
    hidden: state().hiddenMessageIds,
    selected: state().selectedMessageIds,
    anchor: state().selectionAnchor,
  });
  const NONE = { isCaptureMode: false, hidden: [], selected: [], anchor: null };

  it("another conversation in the same project starts with no search and no capture selection", async () => {
    await open(A, A1);
    const tab1 = activeId();
    // Tab 1's find: a query and a match in its own transcript.
    useAppStore.setState({
      sessionSearch: {
        query: "x",
        matches: [{ messageUuid: `${A1.file_path}#290`, messageIndex: 190, matchIndex: 0, matchCount: 1 }],
        currentMatchIndex: 0,
        isSearching: false,
        filterType: "content",
        results: [],
      },
    });
    state().enterCaptureMode();
    const shown = [`${A1.file_path}#290`, `${A1.file_path}#291`];
    state().handleSelectionClick(shown[0]!, shown, { shift: false, cmdOrCtrl: false });
    state().hideMessage(`${A1.file_path}#299`);
    const tab1Capture = capture();

    await openInNewTab(() => open(A, A2));
    expect(state().sessionSearch.query).toBe("");
    expect(state().sessionSearch.matches).toEqual([]);
    expect(capture()).toEqual(NONE);

    // Back in tab 1: its capture state is its own again; the search was
    // left behind with the tab (the find field starts empty on every switch).
    await activateTab(tab1, screens);
    expect(capture()).toEqual(tab1Capture);
    expect(state().sessionSearch.query).toBe("");
    expect(state().sessionSearch.matches).toEqual([]);
  });

  it("two tabs on one conversation keep separate hidden rows", async () => {
    await open(A, A1);
    const tab1 = activeId();
    state().enterCaptureMode();
    state().hideMessage(`${A1.file_path}#299`);

    await openInNewTab(() => open(A, A1));
    const tab2 = activeId();
    expect(capture()).toEqual(NONE);
    state().enterCaptureMode();
    state().hideMessage(`${A1.file_path}#250`);

    await activateTab(tab1, screens);
    expect(state().hiddenMessageIds).toEqual([`${A1.file_path}#299`]);
    await activateTab(tab2, screens);
    expect(state().hiddenMessageIds).toEqual([`${A1.file_path}#250`]);
  });

  it("a new tab and a hint's new tab start with no search and no capture state", async () => {
    await open(A, A1);
    state().enterCaptureMode();
    state().hideMessage(`${A1.file_path}#299`);
    await newTab();
    expect(capture()).toEqual(NONE);

    await activateTab(state().documents[0]!.id, screens);
    expect(state().isCaptureMode).toBe(true);
    await openHintInTab({ project: B, session: B1 }, { epoch: state().beginNavigation(), messageId: null });
    expect(capture()).toEqual(NONE);
  });

  it("every `document` field is the tab's own: not in another tab, back with its tab (stateScope)", async () => {
    // Tab 1 with every per-tab field away from its default: a subagent
    // transcript, a target, history, another screen, capture rows, the
    // board's open message, the analytics sub-tab (T9b).
    await open(A, A1);
    const tab1 = activeId();
    await state().navigateToSubagent(SUBAGENT);
    state().navigateToMessage(`${SUBAGENT.file_path}#1`);
    await state().navigate({ view: "analytics", analyticsTab: "tokens" });
    state().enterCaptureMode();
    state().hideMessage(`${SUBAGENT.file_path}#2`);
    const rows = [`${SUBAGENT.file_path}#0`, `${SUBAGENT.file_path}#1`];
    state().handleSelectionClick(rows[0]!, rows, { shift: false, cmdOrCtrl: false });
    state().setSelectedMessageId(`${SUBAGENT.file_path}#3`);
    const documentFields = fieldsOf("document");
    const tab1Values = pick(documentFields);

    await newTab();
    const fresh = pick(documentFields);
    const leaked = documentFields.filter((f) => same(fresh[f], tab1Values[f]));
    expect(leaked, "per-tab fields that showed tab 1's value in a new tab").toEqual([]);

    await activateTab(tab1, screens);
    const back = pick(documentFields);
    const lost = documentFields.filter((f) => !same(back[f], tab1Values[f]));
    expect(lost, "per-tab fields tab 1 did not get back").toEqual([]);
  });

  it("the board's open message belongs to its tab: a second tab on the same project starts without it (re-review #2)", async () => {
    await open(A, A1);
    const tab1 = activeId();
    state().setSelectedMessageId("a-message");
    await openInNewTab(() => open(A, A2));
    expect(state().selectedMessageId).toBeNull();
    state().setSelectedMessageId("a2-message");
    await activateTab(tab1, screens);
    expect(state().selectedMessageId).toBe("a-message");
    await openInNewTab(() => open(A, A2));
    expect(state().selectedMessageId).toBeNull();
  });

  it("every `reset` field starts over on every switch, into a new tab and back (stateScope)", async () => {
    await open(A, A1);
    const tab1 = activeId();
    const resetFields = fieldsOf("reset");
    setEveryResetField(`${A1.file_path}#1`);
    expect(resetFields.filter((f) => same(pick([f])[f], resetValues()[f])), "reset fields the test did not set").toEqual([]);

    await newTab();
    expect(pick(resetFields)).toEqual(resetValues());

    setEveryResetField(`${A1.file_path}#1`);
    await activateTab(tab1, screens);
    expect(pick(resetFields)).toEqual(resetValues());

    // A switch between two tabs on the same project resets them too.
    await openInNewTab(() => open(A, A2));
    setEveryResetField(`${A2.file_path}#1`);
    await activateTab(tab1, screens);
    expect(pick(resetFields)).toEqual(resetValues());
  });

  it("every `reloaded` field is the place's: a switch shows the incoming tab's place, never the outgoing tab's (stateScope)", async () => {
    // Tab 1 on A/A1 with every reloaded field holding tab 1's value.
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();
    await activateTab(tab1, screens);
    const reloaded = fieldsOf("reloaded");
    useAppStore.setState(tagged(reloaded));
    const tab1Values = pick(reloaded);

    await activateTab(tab2, screens);
    const carried = reloaded.filter((f) => same(pick([f])[f], tab1Values[f]));
    expect(carried, "reloaded fields that kept tab 1's value in tab 2").toEqual([]);
    expect(state().messages.every((m) => m.uuid.startsWith(B1.file_path))).toBe(true);
    expect(state().sessions).toEqual([B1]);
  });

  it("every `screen` field is replaced by its screen's loader when it opens on the incoming tab's place (stateScope)", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();
    await activateTab(tab1, screens);
    const screenFields = fieldsOf("screen");
    useAppStore.setState(tagged(screenFields));
    const tab1Values = pick(screenFields);

    await activateTab(tab2, screens);
    // Nothing shows them until a screen opens; each screen's loader, for
    // tab 2's place, replaces what tab 1 left.
    const get = () => useAppStore.getState();
    await loadTokenStatsScreen(get, B, B1);
    await loadProjectAnalytics(get, B, B1);
    await reloadBoard(get);
    await loadRecentEditsScreen(get);
    const carried = screenFields.filter((f) => same(pick([f])[f], tab1Values[f]));
    expect(carried, "screen fields still holding tab 1's value after tab 2's screens loaded").toEqual([]);
  });

  it("every `app` field is the window's: switching between tabs leaves it as it was (stateScope)", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();
    // The tabs and the navigation themselves: every switch writes them.
    const BOOKKEEPING = [
      "documents",
      "activeDocumentId",
      "hydratedDocumentId",
      "tabsRestorePending",
      "navigationEpoch",
      "recentSessions",
    ];
    const app = fieldsOf("app").filter((f) => !BOOKKEEPING.includes(f));
    expect(BOOKKEEPING.every((f) => fieldsOf("app").includes(f))).toBe(true);
    // Primitives change; objects keep their value (a switch must not write them).
    useAppStore.setState(
      Object.fromEntries(
        app.flatMap((f) => {
          const value = pick([f])[f];
          return ["boolean", "number", "string"].includes(typeof value) ? [[f, tag(value)]] : [];
        }),
      ),
    );
    const before = pick(app);

    await activateTab(tab1, screens);
    expect(app.filter((f) => !same(pick([f])[f], before[f])), "app fields a switch changed").toEqual([]);
    await activateTab(tab2, screens);
    expect(app.filter((f) => !same(pick([f])[f], before[f])), "app fields a switch changed").toEqual([]);
  });

  it("a search still running for tab 1 does not land in tab 2 on the same conversation", async () => {
    await open(A, A1);
    hold(`full:${A1.file_path}`);
    const searching = state().setSessionSearchQuery("x");
    await openInNewTab(() => open(A, A1));

    release(`full:${A1.file_path}`);
    await searching;
    expect(state().sessionSearch.query).toBe("");
    expect(state().sessionSearch.matches).toEqual([]);
    expect(state().sessionSearch.isSearching).toBe(false);
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

describe("a session deleted while its tab is open (review #6)", () => {
  afterEach(() => vi.useRealTimers());

  it("background tab: the watcher event changes nothing; opening the tab shows the in-tab state, no app error", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();

    deleted.add(A1.file_path);
    await state().triggerSessionRefresh(A.path, A1.file_path);
    expect(where()).toEqual([tab2, B.path, B1.file_path]);

    await activateTab(tab1, screens);

    expect(activeId()).toBe(tab1);
    expect(tabOf(tab1)?.unavailable).toBe("session");
    expect(state().error).toBeNull();
    expect(toastMock.error).not.toHaveBeenCalled();
    // The tab keeps naming what it had; nothing half-loaded stays on screen.
    expect(tabOf(tab1)?.session?.filePath).toBe(A1.file_path);
    expect(state().selectedSession).toBeNull();
    expect(state().messages).toEqual([]);
    expect(state().isLoadingMessages).toBe(false);
    // The other tab is untouched.
    expect(tabOf(tab2)?.session?.filePath).toBe(B1.file_path);
  });

  it("active tab: the watcher's reload shows the in-tab state, no app error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    await activateTab(tab1, screens);
    expect(state().messages.length).toBeGreaterThan(0);

    deleted.add(A1.file_path);
    await state().triggerSessionRefresh(A.path, A1.file_path);
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => expect(tabOf(tab1)?.unavailable).toBe("session"));
    expect(state().error).toBeNull();
    expect(activeId()).toBe(tab1);
    expect(tabOf(tab1)?.session?.filePath).toBe(A1.file_path);
    expect(state().selectedSession).toBeNull();
    expect(state().selectedProject?.path).toBe(A.path);
  });

  it("opening a deleted session from the sidebar inside a tab shows the in-tab state, naming it", async () => {
    await open(A, A1);
    const tab1 = activeId();
    deleted.add(A2.file_path);
    await open(A, A2);

    expect(tabOf(tab1)?.unavailable).toBe("session");
    expect(tabOf(tab1)?.session?.filePath).toBe(A2.file_path);
    expect(state().error).toBeNull();
    // Moving on inside the tab clears it.
    await open(A, A1);
    expect(tabOf(tab1)?.unavailable).toBeNull();
    expect(state().selectedSession?.file_path).toBe(A1.file_path);
  });
});

describe("a project folder deleted between scans (re-review #1)", () => {
  /** The tab's own notice, and nothing of the app's error screen. */
  const expectProjectNotice = (id: string) => {
    expect(state().error).toBeNull();
    expect(tabOf(id)?.unavailable).toBe("project");
    expect(state().selectedProject).toBeNull();
    expect(state().selectedSession).toBeNull();
    expect(state().messages).toEqual([]);
    expect(state().isLoadingSessions).toBe(false);
    expect(state().isLoadingMessages).toBe(false);
  };

  it.each([
    ["another project's tab", () => openInNewTab(() => open(B, B1))],
    ["an empty tab", () => newTab()],
  ])(
    "reopening a tab whose project folder is gone (from %s): the tab's notice, no app error; the other tab still works",
    async (_from, leave) => {
      await open(A, A1);
      const tab1 = activeId();
      await leave();
      const tab2 = activeId();
      const tab2Place = tabOf(tab2);

      deletedProjects.add(A.path);
      apiMock.mockClear();
      await expect(activateTab(tab1, screens)).resolves.toBe(true);

      expect(activeId()).toBe(tab1);
      expectProjectNotice(tab1);
      // The session load that depended on the project never started.
      expect(messageCalls().filter((c) => c.sessionPath === A1.file_path)).toEqual([]);
      expect(toastMock.error).not.toHaveBeenCalled();
      // The tab keeps naming what it had.
      expect(tabOf(tab1)?.project?.path).toBe(A.path);
      expect(tabOf(tab1)?.session?.filePath).toBe(A1.file_path);

      // Every other tab is untouched and opens.
      expect(tabOf(tab2)?.session).toEqual(tab2Place?.session);
      await expect(activateTab(tab2, screens)).resolves.toBe(true);
      expect(where()).toEqual([tab2, tab2Place?.project?.path ?? null, tab2Place?.session?.filePath ?? null]);
      expect(state().error).toBeNull();
      expect(tabOf(tab1)?.unavailable).toBe("project");

      // The folder is back: the tab opens its place again from its refs.
      deletedProjects.clear();
      await expect(activateTab(tab1, screens)).resolves.toBe(true);
      expect(where()).toEqual([tab1, A.path, A1.file_path]);
      expect(tabOf(tab1)?.unavailable).toBeNull();
    },
  );

  it("a move inside a tab to a project whose folder is gone shows the tab's notice, naming that project", async () => {
    await open(B, B1);
    const tab = activeId();
    deletedProjects.add(A.path);
    await expect(open(A, A1)).resolves.toBe(true);

    expectProjectNotice(tab);
    expect(tabOf(tab)?.project?.path).toBe(A.path);
    expect(messageCalls().filter((c) => c.sessionPath === A1.file_path)).toEqual([]);
    // Moving on inside the tab clears it.
    await open(B, B1);
    expect(tabOf(tab)?.unavailable).toBeNull();
    expect(where()).toEqual([tab, B.path, B1.file_path]);
  });

  it("the watcher's reload of the open project whose folder is gone shows the tab's notice", async () => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    await activateTab(tab1, screens);

    deletedProjects.add(A.path);
    await state().triggerProjectRefresh(A.path);

    expectProjectNotice(tab1);
    expect(tabOf(tab1)?.session?.filePath).toBe(A1.file_path);
  });

  it.each([
    ["a busy file (Windows)", "Failed to read session: The process cannot access the file because it is being used by another process. (os error 32)"],
    ["a dropped connection (WebUI)", "Failed to fetch"],
    ["a permission error", "Failed to resolve project_path: Permission denied (os error 13)"],
  ])(
    "a watcher reload failing for another reason (%s) keeps the tab as it is, tells the user once, and recovers",
    async (_why, failure) => {
      await open(A, A1);
      const tab1 = activeId();
      const rows = state().sessions;
      const listFailedToasts = () =>
        toastMock.error.mock.calls.filter(([text]) => String(text).includes(failure)).length;

      listFailures.set(A.path, failure);
      await state().triggerProjectRefresh(A.path);
      await state().triggerProjectRefresh(A.path);
      await state().triggerProjectRefresh(A.path);

      expect(state().error).toBeNull();
      expect(tabOf(tab1)?.unavailable).toBeNull();
      expect(where()).toEqual([tab1, A.path, A1.file_path]);
      expect(state().sessions).toEqual(rows);
      expect(state().isLoadingSessions).toBe(false);
      // One notice for the whole run of failing ticks, not one per tick.
      expect(listFailedToasts()).toBe(1);

      // The next tick reads the list again; a later failure is news again.
      listFailures.clear();
      await state().triggerProjectRefresh(A.path);
      expect(where()).toEqual([tab1, A.path, A1.file_path]);
      listFailures.set(A.path, failure);
      await state().triggerProjectRefresh(A.path);
      expect(listFailedToasts()).toBe(2);
      expect(tabOf(tab1)?.unavailable).toBeNull();
    },
  );

  it("restoring a tab whose project folder is gone shows the tab's notice", async () => {
    startWithStoredTabs([storedTab("t-a", A, A1), storedTab("t-b", B, B1)], "t-a");
    deletedProjects.add(A.path);
    await restoreActiveTab(screens);

    expectProjectNotice("t-a");
    expect(tabOf("t-a")?.session?.filePath).toBe(A1.file_path);
    await expect(activateTab("t-b", screens)).resolves.toBe(true);
    expect(where()).toEqual(["t-b", B.path, B1.file_path]);
    expect(state().error).toBeNull();
  });
});

/**
 * Every loader a tab's place runs (opening it, its screens, its sidebar
 * list, its find) fails for that document only: the app's error screen -
 * which replaces the whole window, tabs included - never shows, and the
 * other tab opens as before. The app-wide failures (startup, the project
 * scan) are `globalError.invariant.test.ts`'s allow-list.
 */
describe("a per-document load failing never raises the app error (sweep)", () => {
  const get = () => useAppStore.getState();
  const rows: Array<[string, string[], () => Promise<unknown>]> = [
    ["the session list's next page", ["load_provider_sessions_page"], async () => {
      useAppStore.setState({ hasMoreSessions: true, sessionsOffset: 1 });
      await state().loadMoreSessions();
    }],
    ["the session's token stats", ["get_session_token_stats"], () => state().loadSessionTokenStats(B1.file_path)],
    ["the project's token stats", ["get_project_token_stats"], () => state().loadProjectTokenStats(B.path)],
    ["the token stats screen", ["get_project_token_stats", "get_session_token_stats"], () => loadTokenStatsScreen(get, B, B1)],
    ["the global stats screen", ["get_global_stats_summary"], async () => {
      await state().navigate({ view: "globalStats" });
      await state().loadGlobalStats();
    }],
    ["project analytics", ["get_project_stats_summary"], () => loadProjectAnalytics(get, B, B1)],
    ["recent edits", ["get_recent_edits"], () => loadRecentEditsScreen(get, B).catch(() => undefined)],
    ["the board", ["get_git_log", "load_provider_messages"], () => reloadBoard(get)],
    ["subagents", ["get_session_subagents"], () => state().loadSubagents(B1.file_path, [])],
    ["the cross-session search", ["search_messages"], () => state().searchMessages("x")],
  ];

  it.each(rows)("%s", async (_name, commands, load) => {
    await open(A, A1);
    const tab1 = activeId();
    await openInNewTab(() => open(B, B1));
    const tab2 = activeId();

    commands.forEach((command) => failing.add(command));
    await load();
    failing.clear();

    expect(state().error).toBeNull();
    expect(activeId()).toBe(tab2);
    await expect(activateTab(tab1, screens)).resolves.toBe(true);
    expect(where()).toEqual([tab1, A.path, A1.file_path]);
    expect(state().error).toBeNull();
  });
});

describe("opening in a new tab fails", () => {
  it("a synchronous throw from open removes the new tab, restores the previous one, and rethrows", async () => {
    await open(A, A1);
    const tab1 = activeId();
    const count = state().documents.length;
    const boom = new Error("sync boom");

    await expect(
      openInNewTab(() => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(activeId()).toBe(tab1);
    expect(state().documents).toHaveLength(count);
    expect(where()).toEqual([tab1, A.path, A1.file_path]);
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
  it("a tab saved on the analytics tokens sub-tab reopens on it (T9b)", async () => {
    startWithStoredTabs(
      [storedTab("t-a", A, A1, { view: "analytics", analyticsTab: "tokens" }), storedTab("t-b", B, B1)],
      "t-a",
    );
    vi.mocked(screens.openView).mockClear();
    await restoreActiveTab(screens);
    expect(where()).toEqual(["t-a", A.path, A1.file_path]);
    expect(state().view).toBe("analytics");
    expect(state().analyticsTab).toBe("tokens");
    expect(screens.openView).toHaveBeenCalledWith("analytics");
  });

  it("the migration never throws when reading localStorage itself throws (blocked storage)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      expect(() => runUiStorageMigrations()).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    }
  });

  it("an old tabs.v1 token stats tab opens as analytics › tokens after the one-time migration (T9b)", async () => {
    const legacyDoc = {
      ...JSON.parse(serializeTabs({ documents: [storedTab("t-old", A, A1)], activeId: "t-old" })).documents[0],
      view: "tokenStats",
    };
    delete legacyDoc.analyticsTab;
    localStorage.removeItem(TABS_STORAGE_KEY);
    localStorage.removeItem(UI_STORAGE_VERSION_KEY);
    localStorage.setItem(LEGACY_TABS_STORAGE_KEY, JSON.stringify({ version: 1, activeId: "t-old", documents: [legacyDoc] }));
    runUiStorageMigrations(localStorage);
    useAppStore.setState(initialDocumentState());
    expect(state().tabsRestoreReport).toEqual({ corrupt: false, dropped: 0 });

    await restoreActiveTab(screens);
    expect(where()).toEqual(["t-old", A.path, A1.file_path]);
    expect(state().view).toBe("analytics");
    expect(state().analyticsTab).toBe("tokens");
    expect(localStorage.getItem(LEGACY_TABS_STORAGE_KEY)).toBeNull();
  });

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
    expect(stored.version).toBe(2);
    expect(stored.activeId).toBe(activeId());
    expect(stored.documents.map((d: TabDocument) => d.session?.projectPath)).toEqual([A.path, B.path]);
    expect(JSON.stringify(stored)).not.toContain('"live"');
  });
});
