import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SimpleUpdateModal } from "@/components/SimpleUpdateModal";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";

const {
  toastSuccessMock,
  toastErrorMock,
  openModalMock,
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  openModalMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/contexts/modal", () => ({
  useModal: () => ({
    openModal: openModalMock,
  }),
}));

vi.mock("@/components/ui", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/loading", () => ({
  LoadingSpinner: () => <span data-testid="loading-spinner" />,
  LoadingProgress: ({ progress }: { progress: number }) => (
    <div data-testid="loading-progress">{progress}</div>
  ),
}));

function createUpdater(
  stateOverrides: Partial<UseUpdaterReturn["state"]> = {}
): UseUpdaterReturn {
  return {
    state: {
      isChecking: false,
      hasUpdate: true,
      isDownloading: false,
      isInstalling: false,
      isRestarting: false,
      downloadProgress: 0,
      error: "update.manual_restart_required",
      updateInfo: null,
      currentVersion: "1.5.0",
      newVersion: "1.5.1",
      ...stateOverrides,
    },
    checkForUpdates: vi.fn(async () => null),
    downloadAndInstall: vi.fn(async () => {}),
    dismissUpdate: vi.fn(),
  };
}

function createMockUpdateInfo(
  overrides: Partial<NonNullable<UseUpdaterReturn["state"]["updateInfo"]>> = {}
): NonNullable<UseUpdaterReturn["state"]["updateInfo"]> {
  return {
    available: true,
    currentVersion: "1.5.0",
    version: "1.5.1",
    date: "2026-02-21T00:00:00.000Z",
    body: "",
    rawJson: {},
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    downloadAndInstall: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  } as NonNullable<UseUpdaterReturn["state"]["updateInfo"]>;
}

describe("SimpleUpdateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows failure guide and copy diagnostics button when update fails", () => {
    const updater = createUpdater();

    render(
      <SimpleUpdateModal
        updater={updater}
        isVisible={true}
        onClose={vi.fn()}
        onRemindLater={vi.fn()}
        onSkipVersion={vi.fn()}
      />
    );

    expect(screen.getByText("simpleUpdateModal.failureGuide")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "simpleUpdateModal.reportIssue" })
    ).toBeInTheDocument();
  });

  it("renders release notes from updater body", () => {
    const updater = createUpdater({
      updateInfo: createMockUpdateInfo({
        body: "- Fix updater restart flow\n- Improve diagnostics",
      }),
    });

    render(
      <SimpleUpdateModal
        updater={updater}
        isVisible={true}
        onClose={vi.fn()}
        onRemindLater={vi.fn()}
        onSkipVersion={vi.fn()}
      />
    );

    expect(screen.getByText("simpleUpdateModal.changes")).toBeInTheDocument();
    expect(screen.getByTestId("update-release-notes")).toHaveTextContent(
      "- Fix updater restart flow"
    );
    expect(screen.getByTestId("update-release-notes")).toHaveTextContent(
      "- Improve diagnostics"
    );
  });

  it("falls back to release notes from rawJson when body is empty", () => {
    const updater = createUpdater({
      updateInfo: createMockUpdateInfo({
        body: "",
        rawJson: {
          notes: "Fallback release notes",
          releaseName: "v1.5.1 Hotfix",
        },
      }),
    });

    render(
      <SimpleUpdateModal
        updater={updater}
        isVisible={true}
        onClose={vi.fn()}
        onRemindLater={vi.fn()}
        onSkipVersion={vi.fn()}
      />
    );

    expect(screen.getByTestId("update-release-name")).toHaveTextContent(
      "simpleUpdateModal.releaseName"
    );
    expect(screen.getByTestId("update-release-name")).toHaveTextContent(
      "v1.5.1 Hotfix"
    );
    expect(screen.getByTestId("update-release-notes")).toHaveTextContent(
      "Fallback release notes"
    );
  });

  it("opens feedback modal with diagnostics prefilled when reporting issue", async () => {
    const updater = createUpdater();
    const onClose = vi.fn();

    render(
      <SimpleUpdateModal
        updater={updater}
        isVisible={true}
        onClose={onClose}
        onRemindLater={vi.fn()}
        onSkipVersion={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "simpleUpdateModal.reportIssue" })
    );

    await waitFor(() => {
      expect(openModalMock).toHaveBeenCalledTimes(1);
    });

    expect(openModalMock).toHaveBeenCalledWith(
      "feedback",
      expect.objectContaining({
        feedbackPrefill: expect.objectContaining({
          feedbackType: "bug",
          subject: "simpleUpdateModal.reportIssueSubject",
        }),
      })
    );

    const openArgs = openModalMock.mock.calls[0][1] as {
      feedbackPrefill?: { body?: string };
    };
    expect(openArgs.feedbackPrefill?.body).toContain("[Updater Diagnostics]");
    expect(openArgs.feedbackPrefill?.body).toContain(
      "error=update.manual_restart_required"
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
