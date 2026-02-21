import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SimpleUpdateManager } from "../components/SimpleUpdateManager";
import type { UseUpdaterReturn } from "../hooks/useUpdater";
import type { UpdateSettings } from "../types/updateSettings";
import { UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE } from "../utils/updateError";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const baseUpdateSettings: UpdateSettings = {
  autoCheck: true,
  checkInterval: "startup",
  skippedVersions: [],
  postponeInterval: 24 * 60 * 60 * 1000,
  hasSeenIntroduction: false,
  respectOfflineStatus: true,
  allowCriticalUpdates: true,
};

const mockStore = {
  updateSettings: { ...baseUpdateSettings },
  loadUpdateSettings: vi.fn(async () => {}),
  setUpdateSetting: vi.fn(async () => {}),
  postponeUpdate: vi.fn(async () => {}),
  skipVersion: vi.fn(async () => {}),
};

vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

vi.mock("../components/SimpleUpdateModal", () => ({
  SimpleUpdateModal: ({
    isVisible,
    onRemindLater,
    onSkipVersion,
  }: {
    isVisible: boolean;
    onRemindLater: () => Promise<void> | void;
    onSkipVersion: () => Promise<void> | void;
  }) => (
    <div data-testid="simple-update-modal" data-visible={isVisible ? "true" : "false"}>
      {isVisible && (
        <>
          <button onClick={() => void onRemindLater()}>remind-later</button>
          <button onClick={() => void onSkipVersion()}>skip-version</button>
        </>
      )}
    </div>
  ),
}));

vi.mock("../components/UpdateCheckingNotification", () => ({
  UpdateCheckingNotification: ({ isVisible }: { isVisible: boolean }) =>
    isVisible ? <div data-testid="checking-notification" /> : null,
}));

vi.mock("../components/UpToDateNotification", () => ({
  UpToDateNotification: ({ isVisible }: { isVisible: boolean }) =>
    isVisible ? <div data-testid="uptodate-notification" /> : null,
}));

vi.mock("../components/UpdateErrorNotification", () => ({
  UpdateErrorNotification: ({
    isVisible,
    error,
  }: {
    isVisible: boolean;
    error: string;
  }) =>
    isVisible ? <div data-testid="error-notification">{error}</div> : null,
}));

function createUpdater(
  stateOverrides: Partial<UseUpdaterReturn["state"]> = {}
): UseUpdaterReturn {
  return {
    state: {
      isChecking: false,
      hasUpdate: false,
      isDownloading: false,
      isRestarting: false,
      downloadProgress: 0,
      error: null,
      updateInfo: null,
      currentVersion: "1.0.0",
      newVersion: null,
      ...stateOverrides,
    },
    checkForUpdates: vi.fn(async () => null),
    downloadAndInstall: vi.fn(async () => {}),
    dismissUpdate: vi.fn(),
  };
}

describe("SimpleUpdateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.updateSettings = { ...baseUpdateSettings };
  });

  it("handles manual update check event and records lastCheckedAt", async () => {
    const updater = createUpdater();

    render(<SimpleUpdateManager updater={updater} />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event("manual-update-check"));
    });

    await waitFor(() => {
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockStore.setUpdateSetting).toHaveBeenCalledWith(
        "lastCheckedAt",
        expect.any(Number)
      );
    });
  });

  it("reminds later by postponing and dismissing update", async () => {
    const updater = createUpdater({ hasUpdate: true, newVersion: "2.0.0" });

    render(<SimpleUpdateManager updater={updater} />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("remind-later"));

    await waitFor(() => {
      expect(mockStore.postponeUpdate).toHaveBeenCalledTimes(1);
      expect(updater.dismissUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("skips version and dismisses update", async () => {
    const updater = createUpdater({ hasUpdate: true, newVersion: "2.0.0" });

    render(<SimpleUpdateManager updater={updater} />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("skip-version"));

    await waitFor(() => {
      expect(mockStore.skipVersion).toHaveBeenCalledWith("2.0.0");
      expect(updater.dismissUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("suppresses auto-check modal when version is skipped", async () => {
    mockStore.updateSettings = {
      ...baseUpdateSettings,
      skippedVersions: ["2.0.0"],
    };

    const updater = createUpdater({ hasUpdate: true, newVersion: "2.0.0" });

    render(<SimpleUpdateManager updater={updater} />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(updater.dismissUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("shows error notification when postpone action fails", async () => {
    mockStore.postponeUpdate.mockRejectedValueOnce(new Error("postpone failed"));
    const updater = createUpdater({ hasUpdate: true, newVersion: "2.0.0" });

    render(<SimpleUpdateManager updater={updater} />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("remind-later"));

    await waitFor(() => {
      expect(screen.getByTestId("error-notification")).toHaveTextContent("postpone failed");
    });

    expect(updater.dismissUpdate).not.toHaveBeenCalled();
  });

  it("shows localized manual restart message for updater error code", async () => {
    const updater = createUpdater({
      isChecking: false,
      hasUpdate: false,
      error: UPDATE_MANUAL_RESTART_REQUIRED_ERROR_CODE,
    });

    render(<SimpleUpdateManager updater={updater} />);

    await waitFor(() => {
      expect(mockStore.loadUpdateSettings).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      window.dispatchEvent(new Event("manual-update-check"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("error-notification")).toHaveTextContent(
        "common.error.updateManualRestartRequired"
      );
    });
  });
});
