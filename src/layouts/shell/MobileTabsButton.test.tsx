/**
 * The phone's tab sheet and keyboard focus (T8 review #8, WCAG 2.4.3): the
 * sheet gives focus back to the toolbar's tab-count button when it closes -
 * by Escape, by opening a tab, by starting a new one - and closing a tab in
 * the list keeps focus in the list. Real store, real Radix sheet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const apiMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/services/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import i18n from "@/i18n";
import { useAppStore } from "@/store/useAppStore";
import { newTab, type TabScreens } from "@/navigation/tabs";
import { MobileTabsButton } from "./MobileTabsButton";

const pristine = useAppStore.getState();
const screens: TabScreens = { openView: async () => undefined };
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const countButton = () => document.querySelector<HTMLButtonElement>("[data-mobile-tabs]")!;
const dialog = () => screen.queryByRole("dialog");

async function openSheet() {
  countButton().focus();
  await act(async () => {
    fireEvent.click(countButton());
  });
  await waitFor(() => expect(dialog()).not.toBeNull());
}

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  await i18n.changeLanguage("en");
  useAppStore.setState(pristine, true);
  await act(async () => {
    await newTab();
    await newTab();
  });
});

afterEach(() => vi.restoreAllMocks());

describe("mobile tab sheet focus (review #8)", () => {
  it("Escape closes the sheet and focus returns to the tab-count button", async () => {
    render(<MobileTabsButton screens={screens} />);
    await openSheet();
    expect(dialog()!.contains(document.activeElement)).toBe(true);

    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(countButton());
  });

  it("opening a tab from the sheet returns focus to the tab-count button", async () => {
    render(<MobileTabsButton screens={screens} />);
    await openSheet();
    const first = within(dialog()!).getAllByRole("listitem")[0]!;
    await act(async () => {
      fireEvent.click(within(first).getAllByRole("button")[0]!);
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(countButton());
  });

  it("starting a new tab from the sheet returns focus to the tab-count button", async () => {
    render(<MobileTabsButton screens={screens} />);
    await openSheet();
    await act(async () => {
      fireEvent.click(within(dialog()!).getByRole("button", { name: t("common.command.newTab") }));
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(document.activeElement).toBe(countButton());
  });

  it("closing a tab in the list keeps focus in the list, on the row that takes its place", async () => {
    render(<MobileTabsButton screens={screens} />);
    await openSheet();
    const rows = () => within(dialog()!).getAllByRole("listitem");
    expect(rows()).toHaveLength(3);
    const closeButtons = () => rows().map((row) => within(row).getAllByRole("button")[1]!);
    closeButtons()[1]!.focus();
    await act(async () => {
      fireEvent.click(closeButtons()[1]!);
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeButtons()[1]);
  });
});
