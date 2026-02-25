import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useUpdater } from "../hooks/useUpdater";
import { SimpleUpdateManager } from "../components/SimpleUpdateManager";
import { SettingDropdown } from "../layouts/Header/SettingDropdown/index";
import { PlatformProvider } from "../contexts/platform";
import type { UpdateSettings } from "../types/updateSettings";

// Simulate Tauri environment so isTauri() returns true
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__TAURI_INTERNALS__ = {};
});
afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__;
});

const {
  mockCheck,
  mockRelaunch,
  mockGetVersion,
  mockOpenModal,
} = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockRelaunch: vi.fn(),
  mockGetVersion: vi.fn(),
  mockOpenModal: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockRelaunch,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next"
  );

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/contexts/modal", () => ({
  useModal: () => ({
    openModal: mockOpenModal,
  }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock("../layouts/Header/SettingDropdown/ThemeMenuGroup", () => ({
  ThemeMenuGroup: () => <div data-testid="theme-group" />,
}));

vi.mock("../layouts/Header/SettingDropdown/LanguageMenuGroup", () => ({
  LanguageMenuGroup: () => <div data-testid="language-group" />,
}));

vi.mock("../layouts/Header/SettingDropdown/FilterMenuGroup", () => ({
  FilterMenuGroup: () => <div data-testid="filter-group" />,
}));

const defaultSettings: UpdateSettings = {
  autoCheck: true,
  checkInterval: "startup",
  skippedVersions: [],
  postponeInterval: 24 * 60 * 60 * 1000,
  hasSeenIntroduction: false,
  respectOfflineStatus: true,
  allowCriticalUpdates: true,
};

const mockStore = {
  updateSettings: { ...defaultSettings },
  loadUpdateSettings: vi.fn(async () => {}),
  setUpdateSetting: vi.fn(async () => {}),
  postponeUpdate: vi.fn(async () => {}),
  skipVersion: vi.fn(async () => {}),
};

vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function UpdateFlowHarness() {
  const updater = useUpdater();

  return (
    <PlatformProvider>
      <SettingDropdown updater={updater} />
      <SimpleUpdateManager updater={updater} />
    </PlatformProvider>
  );
}

describe("Update flow integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVersion.mockResolvedValue("1.0.0");
    mockCheck.mockResolvedValue(null);
    mockRelaunch.mockResolvedValue(undefined);
    mockStore.updateSettings = { ...defaultSettings };
  });

  it("runs manual check from settings menu and shows checking -> up-to-date flow", async () => {
    const deferred = createDeferred<null>();
    mockCheck.mockReturnValueOnce(deferred.promise);

    render(<UpdateFlowHarness />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("common.settings.checkUpdate"));

    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("updateSettingsModal.checking")).toBeInTheDocument();
    expect(screen.getByText("common.settings.checking").closest("button")).toBeDisabled();

    await act(async () => {
      deferred.resolve(null);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByText("upToDateNotification.upToDate")).toBeInTheDocument();
      expect(mockStore.setUpdateSetting).toHaveBeenCalledWith(
        "lastCheckedAt",
        expect.any(Number)
      );
    });
  });

  it("supports skip version action from update modal after manual check", async () => {
    const mockDownloadAndInstall = vi.fn();
    mockCheck.mockResolvedValueOnce({
      version: "2.0.0",
      downloadAndInstall: mockDownloadAndInstall,
    });

    render(<UpdateFlowHarness />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("common.settings.checkUpdate"));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "simpleUpdateModal.newUpdateAvailable" })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("simpleUpdateModal.skipVersion"));

    await waitFor(() => {
      expect(mockStore.skipVersion).toHaveBeenCalledWith("2.0.0");
    });
  });
});
