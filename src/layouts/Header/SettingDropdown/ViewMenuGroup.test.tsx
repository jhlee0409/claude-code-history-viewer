import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ViewMenuGroup } from "./ViewMenuGroup";

const { storeState, platform } = vi.hoisted(() => ({
  storeState: {
    isMinimapOpen: false,
    toggleMinimap: vi.fn(),
    showInlineTokenUsage: false,
    toggleInlineTokenUsage: vi.fn(),
    userMetadata: { settings: {} as { liveRefresh?: boolean } },
    toggleLiveRefresh: vi.fn(),
  },
  platform: { isDesktop: true },
}));

vi.mock("@/contexts/platform", () => ({
  DesktopOnly: ({ children }: { children: React.ReactNode }) =>
    platform.isDesktop ? <>{children}</> : null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "keys" in opts ? `${opts.keys} toggles the minimap.` : key,
  }),
}));

vi.mock("@/store/useAppStore", () => ({
  useAppStore: () => storeState,
}));

// Standins for the Radix-backed primitives, mirroring the pattern used for
// `SettingDropdown` in `updateFlow.integration.test.tsx`: a plain DOM shape
// is enough to exercise this group's own behavior without needing a real
// `<DropdownMenu>` wrapper mounted around it.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="label">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    role,
    "aria-checked": ariaChecked,
    title,
  }: {
    children: React.ReactNode;
    onSelect?: (e: { preventDefault: () => void }) => void;
    role?: string;
    "aria-checked"?: boolean;
    title?: string;
  }) => (
    <div
      role={role}
      aria-checked={ariaChecked}
      title={title}
      tabIndex={0}
      onClick={() => onSelect?.({ preventDefault: () => {} })}
    >
      {children}
    </div>
  ),
  DropdownMenuShortcut: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked }: { checked: boolean }) => (
    <span data-testid="switch" data-checked={checked} />
  ),
}));

describe("ViewMenuGroup", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    storeState.isMinimapOpen = false;
    storeState.showInlineTokenUsage = false;
    storeState.userMetadata = { settings: {} };
    platform.isDesktop = true;
  });

  const minimapItem = () => screen.getByRole("menuitemcheckbox", { name: /showMinimap/ });
  const tokensItem = () => screen.getByRole("menuitemcheckbox", { name: /showInlineTokens/ });
  const liveRefreshItem = () => screen.queryByRole("menuitemcheckbox", { name: /liveRefresh/ });

  it("renders its own View heading", () => {
    render(<ViewMenuGroup />);
    expect(screen.getByText("common.settings.view.title")).toBeInTheDocument();
  });

  it("activating the item calls toggleMinimap", () => {
    render(<ViewMenuGroup />);
    minimapItem().click();
    expect(storeState.toggleMinimap).toHaveBeenCalledTimes(1);
    expect(storeState.toggleInlineTokenUsage).not.toHaveBeenCalled();
  });

  it("aria-checked follows the store", () => {
    storeState.isMinimapOpen = true;
    render(<ViewMenuGroup />);
    expect(minimapItem()).toHaveAttribute("aria-checked", "true");
  });

  it("aria-checked is false when the store flag is off", () => {
    storeState.isMinimapOpen = false;
    render(<ViewMenuGroup />);
    expect(minimapItem()).toHaveAttribute("aria-checked", "false");
  });

  it("the token usage item is off by default and toggles inline token usage (#570)", () => {
    render(<ViewMenuGroup />);
    expect(tokensItem()).toHaveAttribute("aria-checked", "false");
    tokensItem().click();
    expect(storeState.toggleInlineTokenUsage).toHaveBeenCalledTimes(1);
    expect(storeState.toggleMinimap).not.toHaveBeenCalled();
  });

  it("the token usage item's checked state follows the store", () => {
    storeState.showInlineTokenUsage = true;
    render(<ViewMenuGroup />);
    expect(tokensItem()).toHaveAttribute("aria-checked", "true");
    expect(minimapItem()).toHaveAttribute("aria-checked", "false");
  });

  it("live refresh is on unless it was turned off, and toggles it (#820)", () => {
    render(<ViewMenuGroup />);
    expect(liveRefreshItem()).toHaveAttribute("aria-checked", "true");
    liveRefreshItem()?.click();
    expect(storeState.toggleLiveRefresh).toHaveBeenCalledTimes(1);
    cleanup();

    storeState.userMetadata = { settings: { liveRefresh: false } };
    render(<ViewMenuGroup />);
    expect(liveRefreshItem()).toHaveAttribute("aria-checked", "false");
  });

  it("live refresh is not offered in the WebUI, whose server runs its own watcher", () => {
    platform.isDesktop = false;
    render(<ViewMenuGroup />);
    expect(liveRefreshItem()).toBeNull();
  });
});
