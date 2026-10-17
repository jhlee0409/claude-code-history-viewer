/**
 * A command acts on the tab the user saw in front when they issued it
 * (docs/adr/0001-native-menu-input-ownership.md §Decision 6: WYSIWYG
 * targeting; review-4 F1, review-5 F1/F2).
 *
 * The real shortcut handler, menu bridge, command context, store and tab
 * actions, on one command queue. The menu journal's pull is held - the
 * startup pull, a refetch after a gap - so a key waits in the queue, and a
 * pointer click on the tab strip (`activateTab` / `closeTab`, outside the
 * queue) lands before the key runs. The fake host stamps every menu event
 * with the tab in front the page last reported (`sync_menu_state`), as
 * `src-tauri/src/menu/journal.rs` does:
 *
 * - ⌘W then a click on tab B closes A, the tab shown at the keypress; two
 *   such ⌘W / click pairs close the two tabs pressed on (review-5 F1);
 * - a command queued earlier never moves a later one's target: a menu New
 *   chosen before ⌘W leaves ⌘W closing the tab the user saw;
 * - a menu Close chosen on A closes A, however late the page hears of it
 *   and whatever was clicked meanwhile (review-5 F2); an event with no
 *   stamp, or a stamp naming a closed tab, does nothing to any tab;
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
import { startMenuBridge, type MenuBridge, type MenuState } from "@/commands/nativeMenu";
import type { LiveMenuEvent, MenuEvent, MenuJournalSnapshot } from "@/commands/menuJournal";

const screens: TabScreens = { openView: nav.openView };
const pristine = useAppStore.getState();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fake host journal whose pulls can be held (an IPC reply still on its
 * way). Like `journal.rs` it stamps each event with the front tab the page
 * last reported; a new host (an app restart) knows none.
 */
function createHost() {
  let seq = 0;
  let retained: MenuEvent[] = [];
  let saved: { epoch: string; seq: number } | null = null;
  /** The front tab the page last reported in `sync_menu_state`. */
  let front: string | null = null;
  const handlers = new Set<(event: LiveMenuEvent) => void>();
  const heldPulls: Array<() => void> = [];
  let holding = false;
  const snapshot = (): MenuJournalSnapshot => ({ epoch: "boot", floor: 0, events: retained.map((e) => ({ ...e })) });
  const record = (id: string): LiveMenuEvent => {
    seq += 1;
    const event = { seq, id, frontTabId: front };
    retained.push(event);
    return { epoch: "boot", ...event };
  };
  return {
    front: () => front,
    /** A menu click while no page listens: kept for the next pull. */
    chooseUnheard(id: string) {
      record(id);
    },
    /** A menu click delivered live. */
    choose(id: string) {
      const event = record(id);
      handlers.forEach((handler) => handler(event));
    },
    /** A menu click recorded now, its live event delivered when the returned function is called. */
    chooseDelayed(id: string) {
      const event = record(id);
      return () => handlers.forEach((handler) => handler(event));
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
      sync: async (state: MenuState) => {
        front = state.frontTabId ?? null;
      },
      // The page reports on every store change, as `nativeMenuHost.ts` wires it.
      subscribe: (onChange: () => void) => useAppStore.subscribe(onChange),
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

function stopInputs() {
  bridge?.stop();
  bridge = null;
  cleanup();
}

/** A tab-strip click, outside the command queue. */
async function click(id: string) {
  void activateTab(id, screens);
  await flush();
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
  stopInputs();
  vi.restoreAllMocks();
});

describe("a key, the palette or a control acts on the tab in front when it was issued (review-4 F1, review-5 F1)", () => {
  it("⌘W during the startup pull, then a click on tab B: A closes, B stays", async () => {
    await openTabs(tab("A"), tab("B"));
    host.holdPulls();
    startInputs();
    press(CLOSE);
    expect(tabs()).toEqual(["A", "B"]); // waiting behind the pull
    await click("B");
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
    await click("B");
    expect(tabs()).toEqual(["A", "B"]);
    host.releasePulls();
    await flush();
    expect(nav.openModal).toHaveBeenCalledTimes(2);
    expect(tabs()).toEqual(["B"]);
  });

  it("⌘W on A, click B, ⌘W on B, click C, all during the startup pull: A and B close, C stays (review-5 F1)", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    host.holdPulls();
    startInputs();
    await flush(); // listener attached, its pull waiting
    press(CLOSE);
    await click("B");
    press(CLOSE);
    await click("C");
    host.releasePulls(); // an empty, successful journal
    await flush();
    expect({ tabs: tabs(), shown: shown() }).toEqual({ tabs: ["C"], shown: "C" });
  });

  it("the same two ⌘W / click pairs behind a refetch after a gap (review-5 F1)", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    startInputs();
    await flush();
    host.chooseUnheard("help.feedback");
    host.holdPulls();
    host.choose("help.feedback"); // a gap: the journal refetches and holds
    press(CLOSE);
    await click("B");
    press(CLOSE);
    await click("C");
    host.releasePulls();
    await flush();
    expect({ tabs: tabs(), shown: shown() }).toEqual({ tabs: ["C"], shown: "C" });
  });

  it("a menu New chosen before ⌘W does not move ⌘W's target: it closes the tab the user saw, a click in between or not", async () => {
    for (const clicked of [false, true]) {
      useAppStore.setState(pristine, true);
      host = createHost();
      queue = createCommandQueue();
      await openTabs(tab("A"), tab("B"));
      host.chooseUnheard("tab.new");
      host.holdPulls();
      startInputs();
      press(CLOSE); // pressed with A in front
      if (clicked) await click("B");
      await flush();
      host.releasePulls();
      await flush();
      expect(tabs(), `click: ${clicked}`).toHaveLength(2);
      expect(tabs(), `click: ${clicked}`).not.toContain("A");
      expect(tabs()[0], `click: ${clicked}`).toBe("B"); // and the new tab after it
      stopInputs();
    }
  });

  it("⌘W then Next Tab, both pressed on A: Next does nothing once ⌘W ahead of it closed A", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    host.holdPulls();
    startInputs();
    press(CLOSE);
    press(NEXT);
    host.releasePulls();
    await flush();
    expect(tabs()).toEqual(["B", "C"]);
    expect(shown()).toBe("B");
  });

  it("Next Tab issued on A does nothing once a click has shown C", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    host.holdPulls();
    startInputs();
    press(NEXT);
    await click("C");
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
    await click("B");
    host.releasePulls();
    await flush();
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("Settings picked in the palette on A does not open in B after a click on B", async () => {
    await openTabs(tab("A"), tab("B"));
    host.holdPulls();
    startInputs();
    expect(dispatchCommand("go.settingsManager", context, queue)).toBe(true);
    await click("B");
    host.releasePulls();
    await flush();
    expect(nav.switchToSettings).not.toHaveBeenCalled();
  });
});

describe("a menu event acts on the tab in front when it was chosen, as the host stamped it (review-5 F2)", () => {
  it("the page reports a front-tab change to the host in the same task as the click", async () => {
    await openTabs(tab("A"), tab("B"));
    startInputs();
    await flush();
    expect(host.front()).toBe("A");
    void activateTab("B", screens);
    expect(shown()).toBe("B");
    expect(host.front()).toBe("B"); // no timer, no reply awaited
  });

  it("a menu Close chosen on A whose live event arrives after a click on B closes A, B stays in front", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    startInputs();
    await flush(); // steady state, A reported
    const deliver = host.chooseDelayed("tab.close"); // recorded with A in front
    await click("B");
    deliver();
    await flush();
    expect({ tabs: tabs(), shown: shown() }).toEqual({ tabs: ["B", "C"], shown: "B" });
  });

  it("a menu Close chosen on A that the reloaded page pulls after a click on B closes A", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    startInputs();
    await flush(); // the old page reported A
    stopInputs(); // a reload: nobody listens
    host.chooseUnheard("tab.close");
    host.holdPulls();
    startInputs();
    await click("B");
    host.releasePulls();
    await flush();
    expect({ tabs: tabs(), shown: shown() }).toEqual({ tabs: ["B", "C"], shown: "B" });
  });

  it("a menu Settings chosen on A, delivered by a refetch after a click on B, does not open in B", async () => {
    await openTabs(tab("A"), tab("B"));
    startInputs();
    await flush();
    host.chooseUnheard("go.settingsManager"); // chosen on A, never heard live
    host.holdPulls();
    host.choose("help.feedback"); // a gap: Settings comes with the refetch
    await click("B");
    host.releasePulls();
    await flush();
    expect(nav.openModal).toHaveBeenCalledTimes(1); // the app-wide one runs
    expect(nav.switchToSettings).not.toHaveBeenCalled();
  });

  it("a menu event with no stamp (no front tab reported yet) runs app commands and touches no tab", async () => {
    await openTabs(tab("A"), tab("B"));
    host.chooseUnheard("tab.close"); // before any page reported its tabs
    host.chooseUnheard("tab.next");
    host.chooseUnheard("help.feedback");
    startInputs();
    await flush();
    await flush();
    expect({ tabs: tabs(), shown: shown() }).toEqual({ tabs: ["A", "B"], shown: "A" });
    expect(nav.openModal).toHaveBeenCalledWith("feedback");
  });

  it("a menu Close or Next Tab stamped with a tab closed since does nothing to the others", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    startInputs();
    await flush();
    const close = host.chooseDelayed("tab.close"); // on A
    const next = host.chooseDelayed("tab.next"); // on A
    void closeTab("A", screens); // the tab strip's × got there first
    await flush();
    expect(shown()).toBe("B");
    close();
    next();
    await flush();
    expect({ tabs: tabs(), shown: shown() }).toEqual({ tabs: ["B", "C"], shown: "B" });
  });

  it("a menu Next Tab chosen on the tab still in front steps from it", async () => {
    await openTabs(tab("A"), tab("B"), tab("C"));
    startInputs();
    await flush();
    host.choose("tab.next");
    await flush();
    expect(shown()).toBe("B");
  });
});
