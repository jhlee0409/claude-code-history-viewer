/**
 * `useAppKeyboard` in the Mac app: the native menu owns the menu commands'
 * shortcuts, so a key press runs its command once - through the menu item -
 * and the bridge is stopped with the hook.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createElement, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { useAppKeyboard } from "./useAppKeyboard";
import type { MenuBridgeDeps, MenuState } from "@/commands/nativeMenu";

const { openModalMock, toggleMinimapMock, host } = vi.hoisted(() => ({
  openModalMock: vi.fn(),
  toggleMinimapMock: vi.fn(),
  host: {
    handlers: new Set<(id: string) => void>(),
    syncs: [] as MenuState[],
    unlistened: 0,
  },
}));

vi.mock("@/commands/keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/commands/keys")>()),
  currentKeyEnvironment: () => ({ os: "mac", runtime: "desktop" }),
}));

vi.mock("@/commands/nativeMenuHost", () => ({
  tauriMenuDeps: (env: MenuBridgeDeps["env"], getContext: MenuBridgeDeps["getContext"]): MenuBridgeDeps => ({
    env,
    getContext,
    getLanguage: () => "en",
    getChecks: () => ({}),
    sync: async (state) => {
      host.syncs.push(state);
      return [];
    },
    listen: async (handler) => {
      host.handlers.add(handler);
      return () => {
        host.handlers.delete(handler);
        host.unlistened += 1;
      };
    },
    subscribe: () => () => {},
  }),
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

/** The OS's order for a menu accelerator: the web view first, then the menu if the page left it. */
function pressMenuKey(init: KeyboardEventInit, id: string) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) host.handlers.forEach((handler) => handler(id));
}

describe("useAppKeyboard in the Mac app", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    host.handlers.clear();
    host.syncs.length = 0;
    host.unlistened = 0;
  });

  it("runs ⌘K once: the menu item runs it and the key listener leaves it", async () => {
    renderHook(() => useAppKeyboard());
    await flush();
    expect(host.syncs).toHaveLength(1);
    pressMenuKey({ key: "k", code: "KeyK", metaKey: true }, "palette.open");
    expect(openModalMock).toHaveBeenCalledTimes(1);
    expect(openModalMock).toHaveBeenCalledWith("globalSearch");
  });

  it("runs ⌘⇧F once under StrictMode", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    renderHook(() => useAppKeyboard(), { wrapper });
    await flush();
    expect(host.handlers.size).toBe(1);
    pressMenuKey({ key: "f", code: "KeyF", metaKey: true, shiftKey: true }, "view.toggleMinimap");
    expect(toggleMinimapMock).toHaveBeenCalledTimes(1);
  });

  it("stops the menu bridge on unmount", async () => {
    const { unmount } = renderHook(() => useAppKeyboard());
    await flush();
    unmount();
    expect(host.unlistened).toBe(1);
    expect(host.handlers.size).toBe(0);
  });
});
