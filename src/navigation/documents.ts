/**
 * Documents: the conversation tabs (plan §4.1, §4.3, T8).
 *
 * A document is one tab: a place (screen + project + session) plus what the
 * tab keeps of its own - the subagent path, the scroll anchor, the explicit
 * message target and its back/forward history. There is one store (plan §3:
 * no message store per tab), so the ACTIVE document is the store's live
 * state; every other document is a snapshot here. Switching tabs saves the
 * outgoing live state into its snapshot and rehydrates the incoming one
 * through `navigate` (`./tabs.ts`).
 *
 * Everything in this file is pure: the model, the tab-list operations (close,
 * cap, cycle) and the `tabs.v1` storage format.
 */
import type { ClaudeProject, ClaudeSession } from "@/types";
import type { PlaceHistoryEntry } from "@/store/slices/navigationSlice";
import { getProjectDisplayName } from "@/utils/pathUtils";
import { isDateTime, libraryRefOf, parseSessionRef } from "./library";
import { projectRefOf, type ProjectRef, type SessionRef, type View } from "./place";

/** localStorage key of the persisted tabs (desktop webview and WebUI alike). */
export const TABS_STORAGE_KEY = "tabs.v1";
export const TABS_STORAGE_VERSION = 1;

/**
 * At most this many tabs (plan §4.3). Opening one more closes the inactive
 * tab used longest ago.
 */
export const MAX_TABS = 20;

/** Back/forward entries kept per tab in storage (each way). */
export const STORED_HISTORY_LIMIT = 10;

/** Where the transcript was scrolled: the first visible message and its offset. */
export interface ScrollAnchor {
  messageUuid: string;
  /** Pixels from the top of the viewport to the top of that message's row. */
  offset: number;
}

/** Why a tab could not be opened; shown inside the tab (§4.1 fallback). */
export type Unavailable = "session" | "project";

/**
 * A tab's capture mode: whether it is on and the transcript rows hidden or
 * selected for the image. The tab's own (`stateScope.ts`): another tab -
 * even on the same conversation - has its own, and it comes back with the
 * tab. Not stored in `tabs.v1`.
 */
export interface CaptureState {
  isCaptureMode: boolean;
  hiddenMessageIds: string[];
  selectedMessageIds: string[];
  selectionAnchor: string | null;
}

export const NO_CAPTURE: CaptureState = {
  isCaptureMode: false,
  hiddenMessageIds: [],
  selectedMessageIds: [],
  selectionAnchor: null,
};

/** The loaded objects of a tab opened in this run; absent after a restore. */
export interface LiveObjects {
  project: ClaudeProject | null;
  session: ClaudeSession | null;
  /** `parentSessionStack`: the parents of a subagent transcript, root first. */
  parentStack: ClaudeSession[];
}

export interface TabDocument {
  id: string;
  view: View;
  project: ProjectRef | null;
  /** With `projectPath`, so a restored tab finds the project listing it. */
  session: SessionRef | null;
  /** Parents of a subagent transcript, root first; empty at top level. */
  subagentStack: SessionRef[];
  anchor: ScrollAnchor | null;
  /** An explicit target (search, deep link). Not stored: it wins once, on open. */
  targetMessageUuid: string | null;
  /** Labels for a tab whose objects are not loaded. */
  title: string | null;
  projectName: string | null;
  lastActiveAt: number;
  history: { back: PlaceHistoryEntry[]; forward: PlaceHistoryEntry[] };
  unavailable: Unavailable | null;
  live?: LiveObjects;
  /** Its capture mode; absent: off, nothing hidden or selected. */
  capture?: CaptureState;
  /**
   * The board's open (expanded) message - a message target of the tab's,
   * like `targetMessageUuid`. Absent: none. Not stored in `tabs.v1`.
   */
  selectedMessageId?: string | null;
}

let idCounter = 0;

/** A new, unique tab id (stable across restarts once stored). */
export function newDocumentId(now: number = Date.now()): string {
  idCounter += 1;
  return `t${now.toString(36)}${idCounter.toString(36)}`;
}

/** An empty tab: the start screen. */
export function blankDocument(id: string = newDocumentId(), now: number = Date.now()): TabDocument {
  return {
    id,
    view: "conversation",
    project: null,
    session: null,
    subagentStack: [],
    anchor: null,
    targetMessageUuid: null,
    title: null,
    projectName: null,
    lastActiveAt: now,
    history: { back: [], forward: [] },
    unavailable: null,
  };
}

/**
 * The part of the live store a document is taken from. Without the capture
 * fields (a place built for a tab that is not open), the tab keeps its own.
 */
export interface LiveState extends Partial<CaptureState> {
  /** Absent (a place built for a tab that is not open): the tab keeps its own. */
  selectedMessageId?: string | null;
  view: View;
  selectedProject: ClaudeProject | null;
  selectedSession: ClaudeSession | null;
  parentSessionStack: ClaudeSession[];
  targetMessageUuid: string | null;
  placeHistory: { back: PlaceHistoryEntry[]; forward: PlaceHistoryEntry[] };
}

/** The capture state the live store holds, or null when `live` names none. */
function captureOf(live: Partial<CaptureState>): CaptureState | null {
  if (live.isCaptureMode === undefined) return null;
  return {
    isCaptureMode: live.isCaptureMode,
    hiddenMessageIds: live.hiddenMessageIds ?? [],
    selectedMessageIds: live.selectedMessageIds ?? [],
    selectionAnchor: live.selectionAnchor ?? null,
  };
}

/** `base` updated to what the live store shows (the active tab's snapshot). */
export function documentFromLive(
  base: TabDocument,
  live: LiveState,
  anchor: ScrollAnchor | null,
): TabDocument {
  const project = live.selectedProject;
  const session = live.selectedSession;
  const stack = live.parentSessionStack;
  return {
    ...base,
    view: live.view,
    project: projectRefOf(project) ?? null,
    session: session ? libraryRefOf(session, project) : null,
    subagentStack: stack.map((parent, i) => (i === 0 ? libraryRefOf(parent, project) : libraryRefOf(parent))),
    anchor: session ? anchor : null,
    targetMessageUuid: live.targetMessageUuid,
    title: session?.summary ?? null,
    projectName: project ? getProjectDisplayName(project) : null,
    history: live.placeHistory,
    unavailable: null,
    live: { project, session, parentStack: stack },
    capture: captureOf(live) ?? base.capture,
    selectedMessageId: live.selectedMessageId !== undefined ? live.selectedMessageId : base.selectedMessageId,
  };
}

/** A subagent transcript as a session of its own (`navigateToSubagent`). */
export function subagentSessionOf(
  ref: SessionRef,
  parent: ClaudeSession,
  summary?: string | null,
): ClaudeSession {
  return {
    session_id: ref.sessionId,
    actual_session_id: ref.actualSessionId ?? ref.sessionId,
    file_path: ref.filePath,
    project_name: parent.project_name,
    message_count: 0,
    first_message_time: "",
    last_message_time: "",
    last_modified: "",
    has_tool_use: false,
    has_errors: false,
    summary: summary ?? ref.actualSessionId ?? ref.sessionId,
    provider: parent.provider ?? (ref.provider as ClaudeSession["provider"]),
  };
}

// ---------------------------------------------------------------------------
// Tab-list operations
// ---------------------------------------------------------------------------

export interface TabList {
  documents: TabDocument[];
  activeId: string;
}

/**
 * The tab to show after `closingId` closes: its right neighbour, else its
 * left one (plan §4.3). Null when it is the only tab.
 */
export function neighbourAfterClose(documents: readonly { id: string }[], closingId: string): string | null {
  const index = documents.findIndex((d) => d.id === closingId);
  if (index === -1) return null;
  return documents[index + 1]?.id ?? documents[index - 1]?.id ?? null;
}

/**
 * Keep at most `max` tabs: the inactive tabs used longest ago close first.
 * The active tab always stays.
 */
export function enforceTabCap(list: TabList, max: number = MAX_TABS): TabList {
  if (list.documents.length <= max) return list;
  const excess = list.documents.length - max;
  const victims = new Set(
    list.documents
      .filter((d) => d.id !== list.activeId)
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
      .slice(0, excess)
      .map((d) => d.id),
  );
  return { ...list, documents: list.documents.filter((d) => !victims.has(d.id)) };
}

/** The tab `step` places away from the active one, wrapping around. */
export function cycledId(list: TabList, step: 1 | -1): string | null {
  const n = list.documents.length;
  if (n < 2) return null;
  const index = list.documents.findIndex((d) => d.id === list.activeId);
  return list.documents[(index + step + n) % n]!.id;
}

/** ⌘1-⌘8 pick that tab; ⌘9 picks the last one, as browsers do. */
export function idAtPosition(documents: readonly TabDocument[], position: number): string | null {
  if (position >= 9) return documents[documents.length - 1]?.id ?? null;
  return documents[position - 1]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Storage: tabs.v1
// ---------------------------------------------------------------------------

interface StoredHistoryEntry {
  view: View;
  project: ClaudeProject | null;
  session: ClaudeSession | null;
  messageId: string | null;
}

interface StoredDocument {
  id: string;
  view: View;
  project: ProjectRef | null;
  session: SessionRef | null;
  subagentStack: SessionRef[];
  anchor: ScrollAnchor | null;
  title: string | null;
  projectName: string | null;
  lastActiveAt: number;
  history: { back: StoredHistoryEntry[]; forward: StoredHistoryEntry[] };
}

interface StoredTabs {
  version: typeof TABS_STORAGE_VERSION;
  activeId: string;
  documents: StoredDocument[];
}

const VIEWS: ReadonlySet<string> = new Set<View>([
  "empty",
  "conversation",
  "analytics",
  "edits",
  "board",
  "globalStats",
  "archive",
  "settingsManager",
  "tokenStats",
]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const textOrNull = (v: unknown): string | null => (isText(v) ? v : null);
const isView = (v: unknown): v is View => typeof v === "string" && VIEWS.has(v);

function parseProjectRef(v: unknown): ProjectRef | null {
  if (!isObject(v) || !isText(v.provider) || !isText(v.path)) return null;
  return { provider: v.provider, path: v.path };
}

function parseAnchor(v: unknown): ScrollAnchor | null {
  if (!isObject(v) || !isText(v.messageUuid) || typeof v.offset !== "number" || !Number.isFinite(v.offset)) {
    return null;
  }
  return { messageUuid: v.messageUuid, offset: v.offset };
}

/** A stored project/session object of a history entry: kept only with its keys. */
function parseProjectObject(v: unknown): ClaudeProject | null {
  return isObject(v) && isText(v.path) && isText(v.name) ? (v as unknown as ClaudeProject) : null;
}

function parseSessionObject(v: unknown): ClaudeSession | null {
  return isObject(v) && isText(v.file_path) && isText(v.session_id) ? (v as unknown as ClaudeSession) : null;
}

function parseHistoryEntry(v: unknown): StoredHistoryEntry | null {
  if (!isObject(v) || !isView(v.view)) return null;
  const project = v.project == null ? null : parseProjectObject(v.project);
  const session = v.session == null ? null : parseSessionObject(v.session);
  if ((v.project != null && !project) || (v.session != null && !session)) return null;
  return { view: v.view, project, session, messageId: textOrNull(v.messageId) };
}

function parseHistory(v: unknown): StoredDocument["history"] {
  const list = (x: unknown) =>
    (Array.isArray(x) ? x : [])
      .map(parseHistoryEntry)
      .filter((e): e is StoredHistoryEntry => e !== null)
      .slice(-STORED_HISTORY_LIMIT);
  return isObject(v) ? { back: list(v.back), forward: list(v.forward) } : { back: [], forward: [] };
}

/** One stored tab, or null when it is not a tab (it is dropped). */
function parseDocument(v: unknown): StoredDocument | null {
  if (!isObject(v) || !isText(v.id) || !isView(v.view) || !isDateTime(v.lastActiveAt)) return null;
  const project = v.project == null ? null : parseProjectRef(v.project);
  const session = v.session == null ? null : parseSessionRef(v.session);
  if ((v.project != null && !project) || (v.session != null && !session)) return null;
  // A session without its project cannot be opened.
  if (session && !project) return null;
  const stack = Array.isArray(v.subagentStack) ? v.subagentStack.map(parseSessionRef) : [];
  if (stack.some((ref) => ref === null)) return null;
  return {
    id: v.id,
    view: v.view,
    project,
    session,
    subagentStack: session ? (stack as SessionRef[]) : [],
    anchor: session ? parseAnchor(v.anchor) : null,
    title: textOrNull(v.title),
    projectName: textOrNull(v.projectName),
    lastActiveAt: v.lastActiveAt,
    history: parseHistory(v.history),
  };
}

export interface ParsedTabs extends TabList {
  /** Stored entries that were not valid tabs and were dropped. */
  dropped: number;
}

export type TabsParseResult =
  | { kind: "none" }
  | { kind: "corrupt" }
  | { kind: "ok"; tabs: ParsedTabs };

/**
 * Read stored tabs. Anything that is not `tabs.v1` - unparsable JSON, another
 * version, no valid tab - is `corrupt` (the caller starts with one empty tab
 * and says so once); a tab that does not validate is dropped and counted.
 * Duplicate ids keep their first tab; more than `MAX_TABS` keep the most
 * recently used ones.
 */
export function parseStoredTabs(raw: string | null): TabsParseResult {
  if (raw == null || raw === "") return { kind: "none" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "corrupt" };
  }
  if (!isObject(value) || value.version !== TABS_STORAGE_VERSION || !Array.isArray(value.documents)) {
    return { kind: "corrupt" };
  }
  const seen = new Set<string>();
  const documents: TabDocument[] = [];
  for (const entry of value.documents) {
    const stored = parseDocument(entry);
    if (!stored || seen.has(stored.id)) continue;
    seen.add(stored.id);
    documents.push({ ...blankDocument(stored.id, stored.lastActiveAt), ...stored, targetMessageUuid: null, unavailable: null });
  }
  const dropped = value.documents.length - documents.length;
  if (documents.length === 0) return { kind: "corrupt" };
  const activeId =
    isText(value.activeId) && seen.has(value.activeId)
      ? value.activeId
      : [...documents].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]!.id;
  const capped = enforceTabCap({ documents, activeId });
  return { kind: "ok", tabs: { ...capped, dropped: dropped + (documents.length - capped.documents.length) } };
}

const storedHistoryEntry = (e: PlaceHistoryEntry): StoredHistoryEntry => ({
  view: e.view,
  project: e.project,
  session: e.session,
  messageId: e.messageId,
});

/** `tabs.v1` for `list`. Live objects and explicit targets are not stored. */
export function serializeTabs(list: TabList): string {
  const stored: StoredTabs = {
    version: TABS_STORAGE_VERSION,
    activeId: list.activeId,
    documents: list.documents.map((d) => ({
      id: d.id,
      view: d.view,
      project: d.project,
      session: d.session,
      subagentStack: d.subagentStack,
      anchor: d.anchor,
      title: d.title,
      projectName: d.projectName,
      lastActiveAt: d.lastActiveAt,
      history: {
        back: d.history.back.slice(-STORED_HISTORY_LIMIT).map(storedHistoryEntry),
        forward: d.history.forward.slice(-STORED_HISTORY_LIMIT).map(storedHistoryEntry),
      },
    })),
  };
  return JSON.stringify(stored);
}

export function loadStoredTabs(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): TabsParseResult {
  try {
    return parseStoredTabs(storage?.getItem(TABS_STORAGE_KEY) ?? null);
  } catch {
    return { kind: "none" };
  }
}

export function saveStoredTabs(list: TabList, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(TABS_STORAGE_KEY, serializeTabs(list));
  } catch {
    // Storage full or unavailable: the tabs still work for this run.
  }
}
