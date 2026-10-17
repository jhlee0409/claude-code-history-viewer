/**
 * A command acts on what was in front of the user when they issued it
 * (docs/adr/0001-native-menu-input-ownership.md §Decision 6, review-4 F1).
 *
 * The real shortcut handler, menu bridge, command context, store and tab
 * actions, on one command queue. The menu journal's pull is held - the
 * startup pull, a refetch after a gap - so a key waits in the queue, and a
 * pointer click on the tab strip (`activateTab` / `closeTab`, outside the
 * queue) lands before the key runs:
 *
 * - ⌘W then a click on tab B closes A, the tab shown at the keypress;
 * - a menu New chosen before ⌘W (delivered by the pull) still makes ⌘W
 *   close the new tab: a command issued earlier moves the target, a pointer
 *   click after it does not;
 * - commands bound to the shown tab (Back, Next Tab, ⌘2, Settings) do nothing
 *   once another tab is shown, or their tab is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const apiMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const nav = vi.hoisted(() => ({
  goBack: vi.fn(),
  goForward: vi.fn(),
  switchToSettings: vi.fn(),
  switchToArchive: vi.fn(),
  openView: vi.fn(async () => undefined),
  openModal: vi.fn(),
}));
vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal: nav.openModal }) }));
vi.mock("@/contexts/platform", () => ({ usePlatform: () => ({ isMobile: false, isDesktop: true }) }));
vi.mock("@/hooks/analytics/useAnalyticsNavigation", () => ({ useAnalyticsNavigation: () => nav }));

import { useAppStore } from "@/store/useAppStore";
import { activateTab, closeTab, type TabScreens } from "@/navigation/tabs";
import { blankDocument, type TabDocument } from "@/navigation/documents";
import { useCommandContext } from "@/commands/useCommandContext";
import { COMMANDS, dispatchCommand, type CommandContext } from "@/commands/registry";
import { createShortcutHandler } from "@/commands/shortcuts";
import { createCommandQueue, type CommandQueue } from "@/commands/commandQueue";
import { startMenuBridge, type MenuBridge } from "@/commands/nativeMenu";
import type { LiveMenuEvent, MenuJournalSnapshot } from "@/commands/menuJournal";

const screens: TabScreens = { openView: nav.openView };
const pristine = useAppStore.getState();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A fake host journal whose pulls can be held (an IPC reply still on its way). */
function createHost() {
  let seq = 0;
  let retained: { seq: number; id: string }[] = [];
  let saved: { epoch: string; seq: number } | null = null;
  const handlers = new Set<(event: LiveMenuEvent) => void>();
  const heldPulls: Array<() => void> = [];
  let holding = false;
  const snapshot = (): MenuJournalSnapshot => ({ epoch: "boot", floor: 0, events: retained.map((e) => ({ ...e })) });
  return {
    /** A menu click while no page listens: kept for the next pull. */
    chooseUnheard(id: string) {
      seq += 1;
      retained.push({ seq, id });
    },
    /** A menu click delivered live. */
    choose(id: string) {
      seq += 1;
      retained.push({ seq, id });
      handlers.forEach((handler) => handler({ epoch: "boot", seq, id }));
    },
    holdPulls() {
      holding = true;
    },
    releasePulls() {
      holding = false;
      heldPulls.splice(0).forEach((answer) => answer());
    },
    deps: {
      getLanguage: () => "en",
      getChecks: () => ({}),
      sync: async () => {},
      subscribe: () => () => {},
      listen: async (handler: (event: LiveMenuEvent) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      pullEvents: () =>
        holding
          ? new Promise<MenuJournalSnapshot>((resolve) => heldPulls.push(() => resolve(snapshot())))
          : Promise.resolve(snapshot()),
      ackEvents: async (_epoch: string, upTo: number) => {
        retained = retained.filter((e) => e.seq > upTo);
      },
      cursor: {
        read: (epoch: string) => (saved?.epoch === epoch ? saved.seq : null),
        write: (epoch: string, s: number) => {
          saved = { epoch, seq: s };
        },
      },
    },
  };
}

type Host = ReturnType<typeof createHost>;

let host: Host;
let queue: CommandQueue;
let bridge: MenuBridge | null = null;
let press: (init: KeyboardEventInit) => void;
let context: () => CommandContext;

const tab = (id: string, history: TabDocument["history"] = { back: [], forward: [] }): TabDocument => ({
  ...blankDocument(id),
  history,
});

/** Tabs `ids`, the first one shown (opened in the live store). */
async function openTabs(...docs: TabDocument[]) {
  const first = docs[0]!;
  useAppStore.setState({
    documents: docs,
    activeDocumentId: first.id,
    hydratedDocumentId: first.id,
    placeHistory: first.history,
  });
  await flush();
}

const tabs = () => useAppStore.getState().documents.map((d) => d.id);
const shown = () => useAppStore.getState().activeDocumentId;

/** Start the app's inputs on one queue: the key listener and the menu bridge. */
function startInputs() {
  const { result } = renderHook(() => useCommandContext());
  const getContext = result.current;
  context = getContext;
  const keys = createShortcutHandler({ commands: COMMANDS, env: { os: "mac", runtime: "desktop" }, getContext, queue });
  press = (init) => keys(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  bridge = startMenuBridge({ ...host.deps, getContext, queue, retryDelaysMs: [10] });
}

const CLOSE = { key: "w", code: "KeyW", metaKey: true };
const BACK = { key: "[", code: "BracketLeft", metaKey: true };
const NEXT = { key: "ArrowRight", code: "ArrowRight", metaKey: true, altKey: true };
const TAB_2 = { key: "2", code: "Digit2", metaKey: true };

beforeEach(() => {
  useAppStore.setState(pristine, true);
  host = createHost();
  queue = createCommandQueue();
  Object.values(nav).forEach((fn) => fn.mockClear());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  bridge?.stop();
  bridge = null;
  cleanup();
  vi.restoreAllMocks();
});

describe("a queued command keeps the target it was issued against (review-4 F1)", () => {
  it("⌘W during the startup pull, then a click on tab B: A closes, B stays", async () => {
    await openTabs(tab("A"), tab("B"));
    host.holdPulls();
    startInputs();
    press(CLOSE);
    expect(tabs()).toEqual(["A", "B"]); // waiting behind the pull
    void activateTab("B", screens); // the tab strip's click, outside the queue
    await flush();
    expect(shown()).toBe("B");
    host.releasePulls(); // an empty journal, well inside the hold limit
    await flush();
    expect(tabs()).toEqual(["B"]);
    expect(shown()).toBe("B");
  });

  it("the same behind a refetch after a gap in the menu events", async () => {
    await openTabs(tab("A"), tab("B"));
    startInputs();
    await flush(); // the startup pull answered: steady state
    host.chooseUnheard("help.feedback"); // seq 1 never arrived live
    host.holdPulls();
    host.choose("help.feedback"); // seq 2 live: a gap, the journal refetches and holds
    press(CLOSE);
    void activateTab("B", screens);
    await flush();
    expect(tabs()).toEqual(["A", "B"]);
    host.releasePulls();
    await flush();
    expect(nav.openModal).toHaveBeenCalledTimes(2);
    expect(tabs()).toEqual(["B"]);
  });

  it("a menu New chosen before ⌘W still makes ⌘W close the new tab, a click in between or not (review-3 F1)", async () => {
    for (const click of [false, true]) {
      useAppStore.setState(pristine, true);
      host = createHost();
      queue = createCommandQueue();
      await openTabs(tab("A"), tab("B"));
      host.chooseUnheard("tab.new");
      host.holdPulls();
      startInputs();
      press(CLOSE);
      if (click) void activateTab("B", screens);
      await flush();
      host.releasePulls();
      await flush();
      expect(tabs(), `click: ${click}`).toEqual(["A", "B"]);
      bridge?.stop();
      bridge = null;
      cleanup();
    }
  });

  it("⌘W then Next Tab, both queued: Next goes on from the tab ⌘W left in front, as when they run at once", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    host.holdPulls();
    startInputs();
    press(CLOSE);
    press(NEXT);
    host.releasePulls();
    await flush();
    expect(tabs()).toEqual(["B", "C"]);
    expect(shown()).toBe("C");
  });

  it("Next Tab issued on A does nothing once a click has shown C", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    host.holdPulls();
    startInputs();
    press(NEXT);
    void activateTab("C", screens);
    await flush();
    host.releasePulls();
    await flush();
    expect(shown()).toBe("C");
  });

  it("⌘2 names the tab second at the keypress: closed meanwhile, nothing else is selected", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    host.holdPulls();
    startInputs();
    press(TAB_2);
    void closeTab("B", screens); // the tab strip's ×
    await flush();
    host.releasePulls();
    await flush();
    expect(tabs()).toEqual(["A", "C"]);
    expect(shown()).toBe("A");
  });

  it("Back issued on A does not step B's history after a click on B", async () => {
    const entry = { view: "conversation", analyticsTab: "overview", project: null, session: null, messageId: null };
    const history = { back: [entry], forward: [] } as unknown as TabDocument["history"];
    await openTabs(tab("A", history), tab("B", history));
    host.holdPulls();
    startInputs();
    press(BACK);
    void activateTab("B", screens);
    await flush();
    host.releasePulls();
    await flush();
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("Settings picked in the palette on A does not open in B after a click on B", async () => {
    await openTabs(tab("A"), tab("B"));
    host.holdPulls();
    startInputs();
    expect(dispatchCommand("go.settingsManager", context, queue)).toBe(true);
    void activateTab("B", screens);
    await flush();
    host.releasePulls();
    await flush();
    expect(nav.switchToSettings).not.toHaveBeenCalled();
  });

  it("a menu event the page first hears of after a click runs on the tab shown then (the documented limit)", async () => {
    await openTabs(tab("A"), tab("B"));
    startInputs();
    await flush();
    host.chooseUnheard("go.settingsManager");
    host.holdPulls();
    host.choose("help.feedback"); // a gap: Settings comes with the refetch
    void activateTab("B", screens);
    await flush();
    host.releasePulls();
    await flush();
    // The page cannot know which tab was in front when the host recorded
    // it: it is issued, for the page, when the journal hands it over.
    expect(nav.switchToSettings).toHaveBeenCalledTimes(1);
  });
});
