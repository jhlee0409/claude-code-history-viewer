import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ViewMenuGroup } from "./ViewMenuGroup";

const { storeState } = vi.hoisted(() => ({
  storeState: {
    isMinimapOpen: false,
    toggleMinimap: vi.fn(),
    expandLongMessages: false,
    setExpandLongMessages: vi.fn(),
  },
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
    storeState.expandLongMessages = false;
  });

  const minimapItem = () =>
    screen.getByText("common.settings.view.showMinimap").closest("[role=menuitemcheckbox]")!;
  const expandItem = () =>
    screen.getByText("common.settings.view.expandLongMessages").closest("[role=menuitemcheckbox]")!;

  it("renders its own View heading", () => {
    render(<ViewMenuGroup />);
    expect(screen.getByText("common.settings.view.title")).toBeInTheDocument();
  });

  it("activating the item calls toggleMinimap", () => {
    render(<ViewMenuGroup />);
    (minimapItem() as HTMLElement).click();
    expect(storeState.toggleMinimap).toHaveBeenCalledTimes(1);
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

  it("activating the expand item toggles expandLongMessages", () => {
    render(<ViewMenuGroup />);
    (expandItem() as HTMLElement).click();
    expect(storeState.setExpandLongMessages).toHaveBeenCalledWith(true);
  });

  it("expand item aria-checked follows the store", () => {
    storeState.expandLongMessages = true;
    render(<ViewMenuGroup />);
    expect(expandItem()).toHaveAttribute("aria-checked", "true");
    (expandItem() as HTMLElement).click();
    expect(storeState.setExpandLongMessages).toHaveBeenCalledWith(false);
  });
});
