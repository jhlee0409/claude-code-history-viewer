/**
 * `useAppKeyboard` in the desktop app (macOS by default): the page runs every
 * app key once and claims it, the menu journal runs menu clicks once in
 * order across StrictMode re-runs and a page reload, and Ctrl + wheel zooms
 * by notch through the zoom commands.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createElement, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { useAppKeyboard } from "./useAppKeyboard";
import type { MenuBridgeDeps, MenuState } from "@/commands/nativeMenu";
import type { LiveMenuEvent, MenuCursorStore } from "@/commands/menuJournal";

const { openModalMock, toggleMinimapMock, newTabMock, closeTabMock, zoomMock, env, host } = vi.hoisted(() => {
  let seq = 0;
  let retained: { seq: number; id: string }[] = [];
  let saved: { epoch: string; seq: number } | null = null;
  const handlers = new Set<(event: LiveMenuEvent) => void>();
  const host = {
    handlers,
    syncs: [] as unknown[],
    unlistened: 0,
    /** Acks are delivered unless the page "goes away" first. */
    dropAcks: false,
    /** sessionStorage: survives a reload of the page. */
    cursor: {
      read: (epoch: string) => (saved?.epoch === epoch ? saved.seq : null),
      write: (epoch: string, s: number) => {
        saved = { epoch, seq: s };
      },
    },
    choose(id: string) {
      seq += 1;
      retained.push({ seq, id });
      handlers.forEach((handler) => handler({ epoch: "boot", seq, id }));
    },
    retained: () => retained.map((e) => e.seq),
    pull: async () => ({ epoch: "boot", floor: 0, events: retained.map((e) => ({ ...e })) }),
    ack: async (_epoch: string, upTo: number) => {
      if (host.dropAcks) return new Promise<void>(() => {});
      retained = retained.filter((e) => e.seq > upTo);
    },
    reset() {
      seq = 0;
      retained = [];
      saved = null;
      handlers.clear();
      host.syncs.length = 0;
      host.unlistened = 0;
      host.dropAcks = false;
    },
  };
  return {
    openModalMock: vi.fn(),
    toggleMinimapMock: vi.fn(),
    newTabMock: vi.fn(),
    closeTabMock: vi.fn(),
    zoomMock: vi.fn(async () => {}),
    env: { os: "mac" as "mac" | "win" | "linux" },
    host,
  };
});

vi.mock("@/commands/keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/commands/keys")>()),
  currentKeyEnvironment: () => ({ os: env.os, runtime: "desktop" }),
}));

vi.mock("@/commands/nativeMenuHost", () => ({
  tauriMenuDeps: (getContext: MenuBridgeDeps["getContext"]): MenuBridgeDeps => ({
    getContext,
    getLanguage: () => "en",
    getChecks: () => ({}),
    sync: async (state: MenuState) => {
      host.syncs.push(state);
    },
    listen: async (handler) => {
      host.handlers.add(handler);
      return () => {
        host.handlers.delete(handler);
        host.unlistened += 1;
      };
    },
    pullEvents: host.pull,
    ackEvents: host.ack,
    cursor: host.cursor as MenuCursorStore,
    subscribe: () => () => {},
  }),
}));

vi.mock("@/commands/zoom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/commands/zoom")>()),
  appZoom: { apply: zoomMock, level: () => 1 },
}));
vi.mock("@/navigation/tabs", () => ({
  newTab: newTabMock,
  closeTab: closeTabMock,
  cycleTab: vi.fn(),
  selectTabAt: vi.fn(),
}));
vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal: openModalMock }) }));
vi.mock("@/contexts/platform", () => ({ usePlatform: () => ({ isMobile: false, isDesktop: true }) }));
vi.mock("@/hooks/analytics/useAnalyticsNavigation", () => ({
  useAnalyticsNavigation: () => ({ goBack: vi.fn(), goForward: vi.fn(), switchToSettings: vi.fn(), switchToArchive: vi.fn() }),
}));
vi.mock("@/store/useAppStore", () => {
  const state = {
    view: "conversation",
    selectedProject: null,
    selectedSession: null,
    placeHistory: { back: [], forward: [] },
    documents: [{ id: "t1" }],
    activeDocumentId: "t1",
    isInspectorOpen: false,
    isMinimapOpen: false,
    toggleMinimap: toggleMinimapMock,
  };
  const useAppStore = (selector: (s: unknown) => unknown) => selector(state);
  useAppStore.getState = () => state;
  return { useAppStore };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const strict = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);

/** macOS order (docs/adr/0001-native-menu-input-ownership.md): the page first; a key it leaves reaches the menu item. */
function pressMenuKey(init: KeyboardEventInit, id: string) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) host.choose(id);
  return event;
}

function ctrlWheel(deltaY: number, wheelDeltaY: number) {
  const event = new WheelEvent("wheel", { deltaY, ctrlKey: true, cancelable: true });
  Object.defineProperty(event, "wheelDeltaY", { value: wheelDeltaY });
  window.dispatchEvent(event);
  return event;
}

describe("useAppKeyboard in the desktop app", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    host.reset();
    env.os = "mac";
  });

  it("runs ⌘K once: the page runs it and claims it, so the menu item does not", async () => {
    renderHook(() => useAppKeyboard());
    await flush();
    const event = pressMenuKey({ key: "k", code: "KeyK", metaKey: true }, "palette.open");
    expect(event.defaultPrevented).toBe(true);
    expect(openModalMock).toHaveBeenCalledTimes(1);
    expect(openModalMock).toHaveBeenCalledWith("globalSearch");
  });

  it("runs ⌘⇧F and a View → Session Minimap click once each under StrictMode", async () => {
    renderHook(() => useAppKeyboard(), { wrapper: strict });
    await flush();
    expect(host.handlers.size).toBe(1);
    pressMenuKey({ key: "f", code: "KeyF", metaKey: true, shiftKey: true }, "view.toggleMinimap");
    expect(toggleMinimapMock).toHaveBeenCalledTimes(1);
    host.choose("view.toggleMinimap");
    await flush();
    expect(toggleMinimapMock).toHaveBeenCalledTimes(2);
  });

  it("runs ⌘T ⌘T ⌘W chosen during a page reload once each, in order, after what the old page ran", async () => {
    const order: string[] = [];
    newTabMock.mockImplementation(() => order.push("new"));
    closeTabMock.mockImplementation(() => order.push("close"));
    const oldPage = renderHook(() => useAppKeyboard(), { wrapper: strict });
    await flush();
    host.dropAcks = true; // the old page's acknowledgement is lost with it
    host.choose("tab.new");
    await flush();
    expect(order).toEqual(["new"]);
    oldPage.unmount();
    host.dropAcks = false;
    // No page listens: the accelerators reach the menu items and are journaled.
    host.choose("tab.new");
    host.choose("tab.new");
    host.choose("tab.close");
    renderHook(() => useAppKeyboard(), { wrapper: strict });
    await flush();
    await flush();
    expect(order).toEqual(["new", "new", "new", "close"]);
    expect(host.retained()).toEqual([]);
  });

  it("zooms one step per Ctrl + wheel notch (WebKit's 40 px notch counts as one)", async () => {
    renderHook(() => useAppKeyboard());
    await flush();
    expect(ctrlWheel(-40, 120).defaultPrevented).toBe(true);
    ctrlWheel(-40, 120);
    ctrlWheel(40, -120);
    expect(zoomMock.mock.calls).toEqual([["in"], ["in"], ["out"]]);
  });

  it("stops the menu bridge on unmount", async () => {
    const { unmount } = renderHook(() => useAppKeyboard());
    await flush();
    unmount();
    expect(host.unlistened).toBe(1);
    expect(host.handlers.size).toBe(0);
  });

  describe("on Windows (WebView2 owns zoom input, review-2 F4)", () => {
    it("binds no zoom key and no Ctrl + wheel, so WebView2 zooms - and pinches - once", async () => {
      env.os = "win";
      renderHook(() => useAppKeyboard());
      await flush();
      const key = new KeyboardEvent("keydown", { key: "=", code: "Equal", ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(false);
      expect(ctrlWheel(-100, 120).defaultPrevented).toBe(false);
      expect(zoomMock).not.toHaveBeenCalled();
      host.choose("view.zoomIn"); // View → Zoom In still sets the engine zoom
      await flush();
      expect(zoomMock.mock.calls).toEqual([["in"]]);
    });
  });
});
