import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CONTRAST_MORE_QUERY, resolveHighContrast, useEffectiveHighContrast } from "@/hooks/useHighContrast";
import { useAppStore } from "@/store/useAppStore";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { AccessibilityMenuGroup } from "@/layouts/Header/SettingDropdown/AccessibilityMenuGroup";

/**
 * High contrast follows the OS until the user chooses (inner-UI plan F1b,
 * D11: user choice > OS prefers-contrast > default).
 */

type Listener = () => void;
let systemMore = false;
let listeners: Listener[] = [];

function setSystemMore(value: boolean) {
  systemMore = value;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  systemMore = false;
  listeners = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query === CONTRAST_MORE_QUERY && systemMore;
      },
      media: query,
      addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
      removeEventListener: (_type: string, listener: Listener) => {
        listeners = listeners.filter((l) => l !== listener);
      },
    })),
  );
  useAppStore.setState({ highContrast: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveHighContrast", () => {
  it.each([
    [null, false, false],
    [null, true, true],
    [false, true, false],
    [true, false, true],
    [true, true, true],
    [false, false, false],
  ] as const)("choice %s, OS more %s -> %s", (choice, system, expected) => {
    expect(resolveHighContrast(choice, system)).toBe(expected);
  });
});

describe("useEffectiveHighContrast", () => {
  it("follows a change of the OS setting while nothing is chosen", () => {
    const { result } = renderHook(() => useEffectiveHighContrast());
    expect(result.current).toBe(false);
    act(() => setSystemMore(true));
    expect(result.current).toBe(true);
  });

  it("an explicit choice wins over the OS setting", () => {
    setSystemMore(true);
    useAppStore.setState({ highContrast: false });
    const { result } = renderHook(() => useEffectiveHighContrast());
    expect(result.current).toBe(false);
  });
});

describe("stored choice", () => {
  it.each([
    [undefined, null],
    ["true", true],
    ["false", false],
  ] as const)("stored %s -> %s (nothing stored = follow the OS)", async (raw, expected) => {
    localStorage.clear();
    if (raw !== undefined) localStorage.setItem("webui:settings.json:highContrast", raw);
    useAppStore.setState({ highContrast: true });
    await useAppStore.getState().loadUpdateSettings();
    expect(useAppStore.getState().highContrast).toBe(expected);
  });
});

describe("gear menu: high contrast item", () => {
  const renderMenu = () =>
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <AccessibilityMenuGroup />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

  it("shows the OS-driven state, and a click stores the opposite as the user's choice", async () => {
    setSystemMore(true);
    const setHighContrast = vi.fn(async (enabled: boolean) => {
      useAppStore.setState({ highContrast: enabled });
    });
    useAppStore.setState({ setHighContrast });
    renderMenu();
    expect(screen.getByRole("switch", { hidden: true })).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      screen.getByRole("menuitem").click();
    });
    expect(setHighContrast).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().highContrast).toBe(false);
    expect(screen.getByRole("switch", { hidden: true })).toHaveAttribute("aria-checked", "false");
  });
});
