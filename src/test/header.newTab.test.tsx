/**
 * ⌘+click (Ctrl+click elsewhere) on a toolbar screen tab opens that screen in
 * a new tab. When the screen fails to open, the user is told and the new tab
 * goes away again - the previous tab is back as it was (PR #673 review).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ClaudeProject } from "@/types";

vi.mock("@/services/api", () => ({ api: vi.fn(async () => null) }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/contexts/modal", () => ({ useModal: () => ({ openModal: vi.fn() }) }));
vi.mock("@/layouts/Header/SettingDropdown", () => ({ SettingDropdown: () => null }));
vi.mock("@/layouts/Header/SessionCopyMenu", () => ({ SessionCopyMenu: () => null }));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "en", on: vi.fn(), off: vi.fn() },
    }),
  };
});

import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/layouts/Header/Header";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";

const PROJECT: ClaudeProject = {
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider: "claude",
};

const COMPUTED = {
  isMessagesView: true,
  isAnalyticsView: false,
  isGlobalStatsView: false,
  isAnalyticsOverview: false,
  isAnalyticsTokens: false,
  isRecentEditsView: false,
  isBoardView: false,
  isSettingsView: false,
  isArchiveView: false,
  isEmptyView: false,
  hasAnyError: false,
  isLoadingAnalytics: false,
  isLoadingTokenStats: false,
  isLoadingRecentEdits: false,
  isAnyLoading: false,
} satisfies UseAnalyticsReturn["computed"];

const pristine = useAppStore.getState();
beforeEach(() => {
  cleanup();
  vi.mocked(toast.error).mockClear();
  useAppStore.setState(pristine, true);
  useAppStore.setState({ view: "conversation", selectedProject: PROJECT, selectedSession: null });
});

describe("⌘+click on a toolbar screen tab", () => {
  it("a screen that fails to open: a toast, and no new tab left behind", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const openView = vi.fn(() => Promise.reject(new Error("analytics failed")));
    const tabsBefore = useAppStore.getState().documents.length;
    const activeBefore = useAppStore.getState().activeDocumentId;

    render(
      <TooltipProvider>
        <Header
          analyticsActions={{ openView } as unknown as UseAnalyticsReturn["actions"]}
          analyticsComputed={COMPUTED}
          updater={{} as UseUpdaterReturn}
        />
      </TooltipProvider>,
    );
    const analytics = screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("data-view") === "analytics" || /analytics/i.test(tab.textContent ?? ""));
    fireEvent.click(analytics!, { metaKey: true, ctrlKey: true });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(openView).toHaveBeenCalledWith("analytics");
    expect(useAppStore.getState().activeDocumentId).toBe(activeBefore);
    expect(useAppStore.getState().documents.length).toBe(tabsBefore);
  });
});
