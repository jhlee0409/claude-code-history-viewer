import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAppKeyboard } from "./useAppKeyboard";

const { openModalMock, toggleNavigatorMock, toggleMinimapMock, platformState } = vi.hoisted(() => ({
  openModalMock: vi.fn(),
  toggleNavigatorMock: vi.fn(),
  toggleMinimapMock: vi.fn(),
  platformState: { isMobile: false },
}));

vi.mock("@/contexts/modal", () => ({
  useModal: () => ({ openModal: openModalMock }),
}));

vi.mock("@/contexts/platform", () => ({
  usePlatform: () => platformState,
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ toggleNavigator: toggleNavigatorMock, toggleMinimap: toggleMinimapMock }),
}));

const press = (key: string, modifiers: KeyboardEventInit = {}, target: EventTarget = window) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
};

describe("useAppKeyboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    platformState.isMobile = false;
    document.body.innerHTML = "";
  });

  it("opens global search on Cmd/Ctrl+K", () => {
    renderHook(() => useAppKeyboard());
    press("k", { ctrlKey: true });
    expect(openModalMock).toHaveBeenCalledWith("globalSearch");
  });

  it("toggles the navigator on Cmd/Ctrl+Shift+M when not mobile", () => {
    renderHook(() => useAppKeyboard());
    press("m", { ctrlKey: true, shiftKey: true });
    expect(toggleNavigatorMock).toHaveBeenCalledTimes(1);
  });

  it("does not toggle the navigator on Cmd/Ctrl+Shift+M when mobile", () => {
    platformState.isMobile = true;
    renderHook(() => useAppKeyboard());
    press("m", { ctrlKey: true, shiftKey: true });
    expect(toggleNavigatorMock).not.toHaveBeenCalled();
  });

  it("toggles the minimap on Cmd/Ctrl+Shift+F from anywhere, including when mobile", () => {
    platformState.isMobile = true;
    renderHook(() => useAppKeyboard());
    const event = press("f", { ctrlKey: true, shiftKey: true });
    expect(toggleMinimapMock).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not fire the minimap shortcut when the target is a text input", () => {
    renderHook(() => useAppKeyboard());
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = press("f", { ctrlKey: true, shiftKey: true }, input);
    expect(toggleMinimapMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not fire the minimap shortcut when the target is a textarea", () => {
    renderHook(() => useAppKeyboard());
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const event = press("f", { ctrlKey: true, shiftKey: true }, textarea);
    expect(toggleMinimapMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not fire the minimap shortcut when the target is a select", () => {
    renderHook(() => useAppKeyboard());
    const select = document.createElement("select");
    document.body.appendChild(select);
    const event = press("f", { ctrlKey: true, shiftKey: true }, select);
    expect(toggleMinimapMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not fire the minimap shortcut when the target is contenteditable", () => {
    renderHook(() => useAppKeyboard());
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    const event = press("f", { ctrlKey: true, shiftKey: true }, div);
    expect(toggleMinimapMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening after unmount", () => {
    const { unmount } = renderHook(() => useAppKeyboard());
    unmount();
    press("f", { ctrlKey: true, shiftKey: true });
    expect(toggleMinimapMock).not.toHaveBeenCalled();
  });
});
