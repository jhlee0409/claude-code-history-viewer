/**
 * The gear menu opens on the `app.preferences` command (Settings… ⌘, in the
 * app menu, and the palette) - plan §6: "그대로 + ⌘,".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SettingDropdown } from "./index";
import { OPEN_PREFERENCES_EVENT } from "@/commands/appEvents";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal: vi.fn() }) }));
vi.mock("@/contexts/platform", () => ({ DesktopOnly: () => null }));
vi.mock("./ThemeMenuGroup", () => ({ ThemeMenuGroup: () => null }));
vi.mock("./LanguageMenuGroup", () => ({ LanguageMenuGroup: () => null }));
vi.mock("./FilterMenuGroup", () => ({ FilterMenuGroup: () => null }));
vi.mock("./ViewMenuGroup", () => ({ ViewMenuGroup: () => null }));
vi.mock("./FontMenuGroup", () => ({ FontMenuGroup: () => null }));
vi.mock("./AccessibilityMenuGroup", () => ({ AccessibilityMenuGroup: () => null }));

const updater = { state: { isChecking: false } } as unknown as UseUpdaterReturn;

describe("SettingDropdown", () => {
  afterEach(cleanup);

  it("opens on the preferences command", () => {
    render(<SettingDropdown updater={updater} />);
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT));
    });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("common.settings.changeFolder")).toBeTruthy();
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<SettingDropdown updater={updater} />);
    unmount();
    act(() => {
      window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT));
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
