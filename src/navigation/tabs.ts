/**
 * Conversation tabs: switching, opening, closing and restoring documents
 * (plan §4.3, T8). The model is `./documents.ts`; the state is
 * `documentSlice`.
 *
 * One store, many documents: the active tab IS the live store. Activating a
 * tab is a navigation (plan §4.2) - it claims the epoch before its first
 * await, saves the outgoing tab from the live store, then rehydrates the
 * incoming one in the §4.3 order:
 *
 *   1. `navigate` (epoch) to the tab's place, with its subagent path;
 *   2. the session loads (newest page);
 *   3. the viewer restores the saved anchor - loading older pages first when
 *      it lives there - once the list is measured (`pendingAnchor`);
 *   4. a project screen loads its data (`openView`).
 *
 * Priority (plan §4.3): an explicit target (search result, deep link, CLI)
 * beats the saved anchor, which beats "scroll to the bottom". Any navigation
 * that begins meanwhile owns the screen; the activation then writes nothing.
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { useAppStore, type AppStore } from "@/store/useAppStore";
import type { PendingAnchor } from "@/store/slices/documentSlice";
import type { ClaudeProject, ClaudeSession } from "@/types";
import { beginHistoryStep, writeWebUIDeepLink, type WebUIHistoryMode } from "@/utils/webuiDeepLink";
import {
  blankDocument,
  cycledId,
  documentFromLive,
  enforceTabCap,
  idAtPosition,
  MAX_TABS,
  neighbourAfterClose,
  NO_CAPTURE,
  saveStoredTabs,
  subagentSessionOf,
  type TabDocument,
  type Unavailable,
} from "./documents";
import { findSession } from "./openSessionRef";
import { ownPlace } from "./ownership";
import type { View } from "./place";
import { captureScrollAnchor } from "./scrollAnchor";

/** What opening a tab needs from the screens: loading a project screen's data. */
export interface TabScreens {
  openView: (view: View) => Promise<unknown>;
}

const get = (): AppStore => useAppStore.getState();
const set = (partial: Partial<AppStore>) => useAppStore.setState(partial);

const providerOf = (p: { provider?: string }) => p.provider ?? "claude";

/**
 * Make `doc` the active tab in the store: what it keeps besides its place
 * comes with it (`stateScope.ts`) - its capture mode (a new tab: none) - and
 * the transcript's find starts empty (its matches are another transcript's;
 * a search still running for the tab left behind lands nowhere). The place
 * itself opens through `navigate` afterwards.
 */
function enterTab(doc: TabDocument, partial: Partial<AppStore>): void {
  set({ ...partial, ...(doc.capture ?? NO_CAPTURE), activeDocumentId: doc.id });
  get().clearSessionSearch();
}

/** Screens whose data loads after the place is committed. */
const LOADS_DATA = (view: View) => view !== "conversation" && view !== "empty";

/**
 * Point the WebUI URL at the active tab as it is now (its session, target
 * and tab id) - for a tab switch the session writes did not cover (two tabs
 * without a session, or on the same one). `history` comes from the move's
 * history step, so a move that already wrote its entry only refines it.
 */
function writeActiveTabUrl(history: WebUIHistoryMode): void {
  const { selectedSession, targetMessageUuid } = get();
  writeWebUIDeepLink(
    {
      sessionId: selectedSession ? selectedSession.actual_session_id || selectedSession.session_id : null,
      messageId: targetMessageUuid,
    },
    history,
  );
}

// ---------------------------------------------------------------------------
// Snapshots and persistence
// ---------------------------------------------------------------------------

/**
 * Every tab, the active one brought up to date from the live store - unless
 * the live store is not that tab yet (it is still opening) or the tab could
 * not be opened (its saved place stays, so the in-tab notice keeps naming it).
 */
export function currentDocuments(state: AppStore = get()): TabDocument[] {
  const { documents, activeDocumentId, hydratedDocumentId } = state;
  if (hydratedDocumentId !== activeDocumentId) return documents;
  return documents.map((doc) =>
    doc.id !== activeDocumentId || doc.unavailable
      ? doc
      : documentFromLive(doc, state, captureScrollAnchor(state.selectedSession?.file_path)),
  );
}

export function persistTabs(): void {
  const state = get();
  saveStoredTabs({ documents: currentDocuments(state), activeId: state.activeDocumentId });
}

const PERSIST_DELAY_MS = 400;

/**
 * Save `tabs.v1` whenever the tabs or the active tab's place change
 * (debounced), and right away when the page goes away. Returns the stop
 * function.
 */
export function startTabsPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    persistTabs();
  };
  const key = (s: AppStore) =>
    [
      s.documents,
      s.activeDocumentId,
      s.hydratedDocumentId,
      s.view,
      s.selectedProject?.path,
      s.selectedSession?.file_path,
      s.parentSessionStack.length,
      s.placeHistory,
    ] as const;
  let last = key(get());
  const unsubscribe = useAppStore.subscribe((state) => {
    const next = key(state);
    if (next.every((value, i) => value === last[i])) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, PERSIST_DELAY_MS);
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("beforeunload", flush);
    if (timer) clearTimeout(timer);
  };
}

/** Say once, at startup, that stored tabs could not all be read. */
export function reportStoredTabsProblems(): void {
  const { corrupt, dropped } = get().tabsRestoreReport;
  if (!corrupt && dropped === 0) return;
  toast.warning(corrupt ? i18n.t("common.tabs.restoreCorrupt") : i18n.t("common.tabs.restoreDropped", { count: dropped }));
  set({ tabsRestoreReport: { corrupt: false, dropped: 0 } });
}

// ---------------------------------------------------------------------------
// Opening a document
// ---------------------------------------------------------------------------

interface Resolved {
  view: View;
  project: ClaudeProject | null;
  session: ClaudeSession | null;
  parentStack: ClaudeSession[];
  unavailable: Unavailable | null;
}

/** The scanned project a tab names, matched by provider and path. */
function projectFor(doc: TabDocument): ClaudeProject | null {
  const ref = doc.project;
  if (!ref) return null;
  return get().projects.find((p) => providerOf(p) === ref.provider && p.path === ref.path) ?? null;
}

/**
 * The objects a tab opens: its live objects when it was open in this run,
 * otherwise looked up from its refs the way the library opens a session.
 * A project that is not scanned (removed, provider turned off) or a session
 * that is gone leaves the tab on the start / "select a session" screen with
 * the reason (`unavailable`), rendered inside the tab.
 */
async function resolveDocument(doc: TabDocument, owns: () => boolean): Promise<Resolved | "superseded"> {
  const project = doc.live?.project ?? projectFor(doc);
  if (doc.project && (!project || !projectFor(doc))) {
    return { view: "conversation", project: null, session: null, parentStack: [], unavailable: "project" };
  }
  if (!doc.session) {
    return { view: doc.view, project, session: null, parentStack: [], unavailable: null };
  }
  if (doc.live?.session) {
    return { view: doc.view, project, session: doc.live.session, parentStack: doc.live.parentStack, unavailable: null };
  }

  const rootRef = doc.subagentStack[0] ?? doc.session;
  let found: Awaited<ReturnType<typeof findSession>>;
  try {
    found = await findSession({ ...rootRef, projectPath: rootRef.projectPath ?? doc.project?.path }, owns);
  } catch (error) {
    if (!owns()) return "superseded";
    console.warn("tabs: could not look up the tab's session:", error);
    found = null;
  }
  if (found === "superseded" || !owns()) return "superseded";
  if (!found) {
    return {
      view: doc.view,
      project,
      session: null,
      parentStack: [],
      unavailable: doc.view === "conversation" ? "session" : null,
    };
  }
  if (doc.subagentStack.length === 0) {
    return { view: doc.view, project: found.project, session: found.session, parentStack: [], unavailable: null };
  }
  // A subagent transcript: its parents again from the root, so the sidechain
  // filter and the way back are what they were (plan §4.3).
  const parents: ClaudeSession[] = [found.session];
  for (const ref of doc.subagentStack.slice(1)) parents.push(subagentSessionOf(ref, parents[parents.length - 1]!));
  return {
    view: doc.view,
    project: found.project,
    session: subagentSessionOf(doc.session, parents[parents.length - 1]!, doc.title),
    parentStack: parents,
    unavailable: null,
  };
}

const sameStack = (a: readonly ClaudeSession[], b: readonly ClaudeSession[]) =>
  a.length === b.length && a.every((s, i) => s.file_path === b[i]?.file_path);

interface OpenOptions {
  epoch: number;
  history: WebUIHistoryMode;
}

/**
 * Rehydrate `doc` into the live store (see the file comment for the order).
 * Resolves true only while the activation still owns the place at the end:
 * a navigation begun meanwhile (another tab, a click) supersedes it, and a
 * caller acting on the result (a popstate moving inside the tab) then writes
 * nothing.
 */
async function openDocument(doc: TabDocument, screens: TabScreens, options: OpenOptions): Promise<boolean> {
  const { epoch } = options;
  let owns = () => get().navigationEpoch === epoch;
  const resolved = await resolveDocument(doc, owns);
  if (resolved === "superseded" || !owns()) return false;

  const { session, parentStack } = resolved;
  const live = get();
  // The session already on screen (two tabs on one conversation) is kept,
  // not reloaded; only its scroll position and target change.
  const keepsSession =
    session != null &&
    live.selectedSession?.file_path === session.file_path &&
    sameStack(live.parentSessionStack, parentStack);
  const anchor: PendingAnchor | undefined =
    resolved.view === "conversation" && session && !doc.targetMessageUuid
      ? { documentId: doc.id, sessionPath: session.file_path, anchor: doc.anchor }
      : undefined;

  const arrived = await get().navigate(
    {
      view: resolved.view,
      project: resolved.project,
      ...(keepsSession ? {} : { session, subagentStack: parentStack }),
      messageId: doc.targetMessageUuid ?? null,
    },
    { epoch, record: false, history: options.history, anchor },
  );
  if (!arrived || !owns()) return false;

  if (resolved.unavailable) {
    const reason = resolved.unavailable;
    set({ documents: get().documents.map((d) => (d.id === doc.id ? { ...d, unavailable: reason } : d)) });
    return true;
  }
  if (LOADS_DATA(resolved.view)) {
    const loading = screens.openView(resolved.view);
    // The screen's loader enters its screen with a navigation of its own
    // before its first await (`enterScreen`): that one is this activation's,
    // and anything after it supersedes both.
    owns = ownPlace(get);
    await loading;
  }
  return owns();
}

export interface ActivateOptions {
  /** WebUI URL history for this switch (default "push"; a popstate passes "none"). */
  history?: WebUIHistoryMode;
  /** An epoch claimed earlier (a CLI hint); superseded meanwhile, nothing happens. */
  epoch?: number;
}

/**
 * Make tab `id` the active one: save the outgoing tab, then open `id`.
 * Resolves whether the tab opened (false when superseded or unknown).
 */
export async function activateTab(id: string, screens: TabScreens, options: ActivateOptions = {}): Promise<boolean> {
  const state = get();
  if (!state.documents.some((d) => d.id === id)) return false;
  if (state.activeDocumentId === id && state.hydratedDocumentId === id) return true;
  if (options.epoch !== undefined && options.epoch !== state.navigationEpoch) return false;

  const now = Date.now();
  const documents = currentDocuments(state).map((d) => (d.id === id ? { ...d, lastActiveAt: now } : d));
  const doc = documents.find((d) => d.id === id)!;
  // The switch is a navigation from here on (plan §4.2).
  const epoch = options.epoch ?? state.beginNavigation();
  const history = options.history ?? "push";
  const historyStep = beginHistoryStep(history);
  enterTab(doc, {
    documents,
    hydratedDocumentId: null,
    placeHistory: doc.history,
    tabsRestorePending: false,
  });
  const arrived = await openDocument(doc, screens, { epoch, history });
  if (!arrived) return false;
  writeActiveTabUrl(historyStep());
  return true;
}

/** Insert `doc` right after the active tab, or at the end; keep the cap. */
function withDocument(documents: TabDocument[], doc: TabDocument, afterActive: boolean): TabDocument[] {
  const at = afterActive ? documents.findIndex((d) => d.id === get().activeDocumentId) + 1 : documents.length;
  const next = [...documents.slice(0, at || documents.length), doc, ...documents.slice(at || documents.length)];
  const capped = enforceTabCap({ documents: next, activeId: doc.id }).documents;
  if (capped.length < next.length) toast.info(i18n.t("common.tabs.limitReached", { max: MAX_TABS }));
  return capped;
}

/** ⌘T: a new, empty tab at the end. */
export async function newTab(): Promise<boolean> {
  const state = get();
  const blank = blankDocument();
  const documents = withDocument(currentDocuments(state), blank, false);
  const epoch = state.beginNavigation();
  const historyStep = beginHistoryStep("push");
  enterTab(blank, {
    documents,
    hydratedDocumentId: null,
    placeHistory: { back: [], forward: [] },
    tabsRestorePending: false,
  });
  const arrived = await get().navigate({ view: "conversation", project: null, session: null }, { epoch, record: false });
  if (!arrived) return false;
  writeActiveTabUrl(historyStep());
  return true;
}

/**
 * ⌘+click: open something in a new tab, right after the current one, and
 * show it. `open` navigates the way a plain click does; the new tab starts
 * as a copy of the current place, so the move is the tab's own first step.
 */
export async function openInNewTab<T>(
  open: () => Promise<T>,
  options: {
    /**
     * A result that means nothing opened (a library entry whose session is
     * gone): the new tab goes away again and the previous one is back as it
     * was - nothing navigated.
     */
    discardIf?: (result: T) => boolean;
  } = {},
): Promise<T> {
  const state = get();
  const previousId = state.activeDocumentId;
  const previousHistory = state.placeHistory;
  const doc = { ...blankDocument(), view: state.view };
  const documents = withDocument(currentDocuments(state), doc, true);
  enterTab(doc, {
    documents,
    hydratedDocumentId: doc.id,
    placeHistory: { back: [], forward: [] },
    tabsRestorePending: false,
  });
  const opening = open();
  // `open` claims its navigation before its first await; anything after it
  // owns the tab list.
  const owns = ownPlace(get);
  const result = await opening;
  const previous = documents.find((d) => d.id === previousId);
  if (owns() && options.discardIf?.(result) && get().activeDocumentId === doc.id && previous) {
    enterTab(previous, {
      documents: get().documents.filter((d) => d.id !== doc.id),
      hydratedDocumentId: previousId,
      placeHistory: previousHistory,
    });
  }
  return result;
}

/**
 * Close tab `id`. Closing the active tab shows its right neighbour, else its
 * left one; closing the last tab leaves one empty tab (plan §4.3).
 */
export async function closeTab(id: string, screens: TabScreens): Promise<boolean> {
  const state = get();
  const documents = currentDocuments(state);
  if (!documents.some((d) => d.id === id)) return false;
  if (id !== state.activeDocumentId) {
    set({ documents: documents.filter((d) => d.id !== id) });
    return true;
  }
  const next = neighbourAfterClose(documents, id);
  if (!next) {
    const blank = blankDocument();
    const historyStep = beginHistoryStep("push");
    enterTab(blank, { documents: [blank], hydratedDocumentId: null, placeHistory: { back: [], forward: [] } });
    const arrived = await get().navigate({ view: "conversation", project: null, session: null }, { record: false });
    if (!arrived) return false;
    writeActiveTabUrl(historyStep());
    return true;
  }
  // The closed tab is not saved on the way out.
  set({ documents: documents.filter((d) => d.id !== id), hydratedDocumentId: null });
  return activateTab(next, screens);
}

/** Next / previous tab, wrapping around. */
export function cycleTab(step: 1 | -1, screens: TabScreens): Promise<boolean> {
  const { activeDocumentId } = get();
  const id = cycledId({ documents: get().documents, activeId: activeDocumentId }, step);
  return id ? activateTab(id, screens) : Promise.resolve(false);
}

/** ⌘1-⌘8: that tab; ⌘9: the last one. */
export function selectTabAt(position: number, screens: TabScreens): Promise<boolean> {
  const id = idAtPosition(get().documents, position);
  return id ? activateTab(id, screens) : Promise.resolve(false);
}

/**
 * Startup, after any CLI / deep-link hint has been handled (plan §4.3
 * barrier): open the tab that was active, if tabs were restored and no hint
 * took over.
 */
export function restoreActiveTab(screens: TabScreens): Promise<boolean> {
  const { tabsRestorePending, activeDocumentId } = get();
  if (!tabsRestorePending) return Promise.resolve(false);
  return activateTab(activeDocumentId, screens, { history: "replace" });
}

/**
 * The active tab could not be opened because its project was not scanned
 * (an empty first scan, a provider turned off); the project list has changed
 * since and now lists it: open the tab (T8). Anything else: nothing.
 */
export function retryUnavailableTab(screens: TabScreens): Promise<boolean> {
  const state = get();
  const doc = state.documents.find((d) => d.id === state.activeDocumentId);
  if (!doc || doc.unavailable !== "project" || !projectFor(doc)) return Promise.resolve(false);
  set({ hydratedDocumentId: null });
  return activateTab(doc.id, screens, { history: "replace" });
}

export interface HintMatch {
  project: ClaudeProject;
  session: ClaudeSession;
}

// ---------------------------------------------------------------------------
// Browser back/forward (WebUI, plan §9b F1)
// ---------------------------------------------------------------------------

/** The place a WebUI history entry names (`?session=&msg=&tab=`). */
export interface UrlPlace {
  sessionId: string | null;
  messageId: string | null;
  tabId?: string | null;
}

/**
 * What a popstate does, decided before anything awaits (plan §9b F1):
 * - `stay`: the URL names no session and no open tab (the bare start URL of
 *   an old page, a closed blank tab) - nothing to apply, and the open tab
 *   keeps everything it has;
 * - `here`: the active tab already shows the URL's session - move inside it;
 * - `tab`: tab `tabId` shows the URL's session, or the URL names that tab
 *   and no session - that tab comes forward, at the URL's place;
 * - `resolve`: the URL's session has to be looked up first, then opens in
 *   tab `tabId` (the tab it names), the active tab (an old URL naming no
 *   tab), or a tab of its own (the tab it names was closed).
 */
export type UrlMove =
  | { kind: "stay" }
  | { kind: "here" }
  | { kind: "tab"; tabId: string }
  | { kind: "resolve"; into: "newTab" | "active" | { tabId: string } };

/** Whether tab `doc` shows the session a URL names (by the id URLs carry). */
const showsSessionId = (doc: TabDocument, sessionId: string): boolean =>
  doc.session != null && (doc.session.actualSessionId === sessionId || doc.session.sessionId === sessionId);

const liveSessionId = (state: AppStore): string | null =>
  state.selectedSession?.actual_session_id || state.selectedSession?.session_id || null;

/** How the popstate for `url` moves (see `UrlMove`). */
export function planUrlMove(url: UrlPlace, state: AppStore = get()): UrlMove {
  const { activeDocumentId } = state;
  const tabId = url.tabId ?? null;
  const documents = currentDocuments(state);
  const named = tabId ? documents.find((d) => d.id === tabId) : undefined;
  if (url.sessionId === null) return named ? { kind: "tab", tabId: named.id } : { kind: "stay" };
  if ((tabId === null || tabId === activeDocumentId) && liveSessionId(state) === url.sessionId) return { kind: "here" };
  if (tabId && !named) return { kind: "resolve", into: "newTab" };
  if (named && showsSessionId(named, url.sessionId)) return { kind: "tab", tabId: named.id };
  return { kind: "resolve", into: named ? { tabId: named.id } : "active" };
}

const POP = { history: "none", record: false } as const;

/** `doc` without its session: the tab as it was before one was opened in it. */
const withoutSession = (doc: TabDocument): TabDocument => ({
  ...doc,
  session: null,
  subagentStack: [],
  anchor: null,
  targetMessageUuid: null,
  title: null,
  unavailable: doc.unavailable === "session" ? null : doc.unavailable,
  live: doc.live ? { ...doc.live, session: null, parentStack: [] } : undefined,
});

/**
 * Bring tab `tabId` forward at the URL's place, as one navigation under the
 * popstate's `epoch`: the URL's place becomes the tab's before it opens, so
 * activating it is the whole move. Superseded, it writes nothing.
 *
 * A URL naming the tab and no session is an entry from before a session was
 * opened in it: the tab comes forward without its session, on its project
 * and screen (back again in history: forward reopens it). Nothing else of
 * the tab - or of any other tab - changes.
 */
export async function openTabAtUrl(
  tabId: string,
  url: UrlPlace,
  screens: TabScreens,
  epoch: number,
): Promise<boolean> {
  const state = get();
  if (state.navigationEpoch !== epoch) return false;
  if (state.activeDocumentId === tabId && state.hydratedDocumentId === tabId) {
    if (url.sessionId !== null) return get().navigate({ view: "conversation", messageId: url.messageId }, { ...POP, epoch });
    return state.selectedSession ? get().navigate({ session: null }, { ...POP, epoch }) : true;
  }
  const documents = currentDocuments(state);
  if (!documents.some((d) => d.id === tabId)) return false;
  const atUrl = (d: TabDocument): TabDocument =>
    url.sessionId === null
      ? d.session
        ? withoutSession(d)
        : d
      : { ...d, view: "conversation", targetMessageUuid: url.messageId };
  set({ documents: documents.map((d) => (d.id === tabId ? atUrl(d) : d)) });
  return activateTab(tabId, screens, { epoch, history: "none" });
}

/**
 * A URL's session, looked up, opens in tab `tabId` - the tab the URL names
 * (§9b F1): it becomes that tab's place and the tab comes forward, under the
 * lookup's epoch. A tab closed meanwhile: the session gets a tab of its own.
 */
export async function openMatchInTab(tabId: string, match: HintMatch, options: HintOpenOptions): Promise<boolean> {
  const state = get();
  if (state.navigationEpoch !== options.epoch) return false;
  const documents = currentDocuments(state);
  const doc = documents.find((d) => d.id === tabId);
  if (!doc) return openHintInTab(match, options);
  if (state.activeDocumentId === tabId && state.hydratedDocumentId === tabId) {
    return get().navigate(
      { view: "conversation", project: match.project, session: match.session, messageId: options.messageId },
      { ...POP, epoch: options.epoch },
    );
  }
  const placed = documentFromLive(
    doc,
    {
      view: "conversation",
      selectedProject: match.project,
      selectedSession: match.session,
      parentSessionStack: [],
      targetMessageUuid: options.messageId,
      placeHistory: doc.history,
    },
    null,
  );
  set({ documents: documents.map((d) => (d.id === tabId ? placed : d)) });
  return activateTab(tabId, NO_SCREENS, { epoch: options.epoch, history: "none" });
}

export interface HintOpenOptions {
  epoch: number;
  messageId: string | null;
  record?: boolean;
}

const NO_SCREENS: TabScreens = { openView: async () => undefined };

/**
 * A CLI / deep-link hint (plan §4.3): its session becomes the active tab. A
 * tab already showing it is reused; an empty active tab takes it; otherwise
 * it opens in a new tab. The hint always wins - over restored tabs and over a
 * session open before a second launch (§9b F4).
 */
export async function openHintInTab(match: HintMatch, options: HintOpenOptions): Promise<boolean> {
  const state = get();
  if (state.navigationEpoch !== options.epoch) return false;
  const documents = currentDocuments(state);
  const existing = documents.find((d) => d.session?.filePath === match.session.file_path && d.subagentStack.length === 0);
  const hydrated = state.hydratedDocumentId === state.activeDocumentId;
  const navigateHere = () =>
    get().navigate(
      { view: "conversation", project: match.project, session: match.session, messageId: options.messageId },
      { history: "none", epoch: options.epoch, record: options.record },
    );

  // A tab showing it is reused - including the restored active tab not
  // opened yet (a WebUI reload whose URL names that tab's session).
  if (existing && !(existing.id === state.activeDocumentId && hydrated)) {
    set({
      documents: documents.map((d) =>
        d.id === existing.id ? { ...d, view: "conversation", targetMessageUuid: options.messageId } : d,
      ),
    });
    return activateTab(existing.id, NO_SCREENS, { epoch: options.epoch, history: "none" });
  }
  const active = documents.find((d) => d.id === state.activeDocumentId);
  const activeIsBlank = hydrated && state.selectedProject == null && !active?.unavailable;
  if ((existing && hydrated) || activeIsBlank) return navigateHere();

  const doc = blankDocument();
  enterTab(doc, {
    documents: withDocument(documents, doc, true),
    hydratedDocumentId: null,
    placeHistory: { back: [], forward: [] },
    tabsRestorePending: false,
  });
  return navigateHere();
}
