import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { useAppKeyboard } from "./useAppKeyboard";
import { registerFindTarget } from "@/commands/findTarget";

// jsdom reports a Linux browser and no Tauri: the WebUI entries with Ctrl.
const {
  openModalMock,
  setInspectorOpenMock,
  toggleMinimapMock,
  goBackMock,
  goForwardMock,
  platformState,
  storeState,
} = vi.hoisted(() => ({
  openModalMock: vi.fn(),
  setInspectorOpenMock: vi.fn(),
  toggleMinimapMock: vi.fn(),
  goBackMock: vi.fn(),
  goForwardMock: vi.fn(),
  platformState: { isMobile: false, isDesktop: false },
  storeState: {
    view: "conversation",
    selectedProject: null as unknown,
    selectedSession: null as unknown,
    placeHistory: { back: [] as unknown[], forward: [] as unknown[] },
    documents: [{ id: "t1" }] as unknown[],
    activeDocumentId: "t1",
    isInspectorOpen: false,
  },
}));

vi.mock("@/contexts/modal", () => ({
  useModal: () => ({ openModal: openModalMock }),
}));

vi.mock("@/contexts/platform", () => ({
  usePlatform: () => platformState,
}));

vi.mock("@/hooks/analytics/useAnalyticsNavigation", () => ({
  useAnalyticsNavigation: () => ({
    goBack: goBackMock,
    goForward: goForwardMock,
    switchToSettings: vi.fn(),
    switchToArchive: vi.fn(),
  }),
}));

vi.mock("@/store/useAppStore", () => {
  const actions = () => ({ setInspectorOpen: setInspectorOpenMock, toggleMinimap: toggleMinimapMock });
  const useAppStore = (selector: (state: unknown) => unknown) => selector({ ...storeState, ...actions() });
  useAppStore.getState = () => ({ ...storeState, ...actions() });
  return { useAppStore };
});

const press = (key: string, modifiers: KeyboardEventInit = {}, target: EventTarget = window) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
};

const SESSION = { session_id: "s1", file_path: "/p/s1.jsonl", provider: "claude" };
const PROJECT = { name: "p", path: "/p", provider: "claude" };

describe("useAppKeyboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    platformState.isMobile = false;
    storeState.view = "conversation";
    storeState.selectedProject = null;
    storeState.selectedSession = null;
    storeState.placeHistory = { back: [], forward: [] };
    document.body.innerHTML = "";
  });

  it("opens global search on Ctrl+K", () => {
    renderHook(() => useAppKeyboard());
    press("k", { ctrlKey: true });
    expect(openModalMock).toHaveBeenCalledWith("globalSearch");
  });

  it("opens global search on Ctrl+K even from a text field", () => {
    renderHook(() => useAppKeyboard());
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("k", { ctrlKey: true }, input);
    expect(openModalMock).toHaveBeenCalledWith("globalSearch");
  });

  it("opens the inspector on Ctrl+Shift+M when not mobile", () => {
    storeState.selectedProject = PROJECT;
    storeState.selectedSession = SESSION;
    renderHook(() => useAppKeyboard());
    press("M", { ctrlKey: true, shiftKey: true });
    expect(setInspectorOpenMock).toHaveBeenCalledTimes(1);
    expect(setInspectorOpenMock).toHaveBeenCalledWith(true);
  });

  it.each([
    ["no session is open", () => {}],
    [
      "the screen has no inspector",
      () => {
        storeState.view = "analytics";
        storeState.selectedProject = PROJECT;
        storeState.selectedSession = SESSION;
      },
    ],
  ])("does not toggle the inspector on Ctrl+Shift+M when %s", (_, arrange) => {
    arrange();
    renderHook(() => useAppKeyboard());
    press("M", { ctrlKey: true, shiftKey: true });
    expect(setInspectorOpenMock).not.toHaveBeenCalled();
  });

  it("does not toggle the inspector on Ctrl+Shift+M when mobile", () => {
    storeState.selectedProject = PROJECT;
    storeState.selectedSession = SESSION;
    platformState.isMobile = true;
    renderHook(() => useAppKeyboard());
    press("m", { ctrlKey: true, shiftKey: true });
    expect(setInspectorOpenMock).not.toHaveBeenCalled();
  });

  it("toggles the minimap on Ctrl+Shift+F from anywhere, including when mobile", () => {
    platformState.isMobile = true;
    renderHook(() => useAppKeyboard());
    const event = press("F", { ctrlKey: true, shiftKey: true });
    expect(toggleMinimapMock).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ["a text input", () => document.createElement("input")],
    ["a textarea", () => document.createElement("textarea")],
    ["a select", () => document.createElement("select")],
    [
      "contenteditable",
      () => {
        const div = document.createElement("div");
        div.setAttribute("contenteditable", "true");
        return div;
      },
    ],
  ])("does not fire the minimap shortcut when the target is %s", (_, make) => {
    renderHook(() => useAppKeyboard());
    const field = make();
    document.body.appendChild(field);
    const event = press("f", { ctrlKey: true, shiftKey: true }, field);
    expect(toggleMinimapMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("goes back and forward on Alt+Arrow (the WebUI fallback for ⌘[ ⌘])", () => {
    storeState.placeHistory = { back: [{}], forward: [{}] };
    renderHook(() => useAppKeyboard());
    press("ArrowLeft", { altKey: true });
    press("ArrowRight", { altKey: true });
    expect(goBackMock).toHaveBeenCalledTimes(1);
    expect(goForwardMock).toHaveBeenCalledTimes(1);
  });

  it("leaves Alt+Arrow to the browser when there is no history", () => {
    renderHook(() => useAppKeyboard());
    const event = press("ArrowLeft", { altKey: true });
    expect(goBackMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  const mountFindField = () => {
    const input = document.body.appendChild(document.createElement("input"));
    input.value = "earlier query";
    return { input, unregister: registerFindTarget(() => input) };
  };

  it("focuses and selects the conversation's find field on Ctrl+F", () => {
    storeState.selectedProject = PROJECT;
    storeState.selectedSession = SESSION;
    const { input, unregister } = mountFindField();
    renderHook(() => useAppKeyboard());
    const event = press("f", { ctrlKey: true });
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(event.defaultPrevented).toBe(true);
    unregister();
  });

  it("leaves Ctrl+F to the browser outside a conversation", () => {
    const { input, unregister } = mountFindField();
    storeState.view = "analytics";
    storeState.selectedProject = PROJECT;
    renderHook(() => useAppKeyboard());
    const event = press("f", { ctrlKey: true });
    expect(document.activeElement).not.toBe(input);
    expect(event.defaultPrevented).toBe(false);
    unregister();
  });

  it("leaves Ctrl+F to the browser while the conversation has no find field", () => {
    storeState.selectedProject = PROJECT;
    storeState.selectedSession = SESSION;
    const unregister = registerFindTarget(() => null);
    renderHook(() => useAppKeyboard());
    expect(press("f", { ctrlKey: true }).defaultPrevented).toBe(false);
    unregister();
  });

  it("ignores shortcuts while an IME is composing", () => {
    renderHook(() => useAppKeyboard());
    press("k", { ctrlKey: true, isComposing: true });
    press("k", { ctrlKey: true, keyCode: 229 } as KeyboardEventInit);
    expect(openModalMock).not.toHaveBeenCalled();
  });

  it("runs a command once per key press under StrictMode", () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    renderHook(() => useAppKeyboard(), { wrapper });
    press("f", { ctrlKey: true, shiftKey: true });
    expect(toggleMinimapMock).toHaveBeenCalledTimes(1);
  });

  it("runs a command once even when the hook is mounted twice", () => {
    renderHook(() => useAppKeyboard());
    renderHook(() => useAppKeyboard());
    press("f", { ctrlKey: true, shiftKey: true });
    expect(toggleMinimapMock).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount", () => {
    const { unmount } = renderHook(() => useAppKeyboard());
    unmount();
    press("f", { ctrlKey: true, shiftKey: true });
    expect(toggleMinimapMock).not.toHaveBeenCalled();
  });
});
