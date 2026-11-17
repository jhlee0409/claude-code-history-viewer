/**
 * Header view tabs characterization (plan T3): order, icons, labels, loading
 * and disabled states of the header's tablist, pinned before the tab
 * metadata moves into the view registry. Rendered against the real store;
 * labels are i18n keys (identity `t`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClaudeProject } from "@/types";
import type { View } from "@/navigation/place";

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
      t: (key: string, options?: { name?: string }) =>
        options?.name ? `${key}(${options.name})` : key,
      i18n: { language: "en", on: vi.fn(), off: vi.fn() },
    }),
  };
});

import { useAppStore } from "@/store/useAppStore";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/layouts/Header/Header";
import type { UseAnalyticsReturn } from "@/types/analytics";
import type { UseUpdaterReturn } from "@/hooks/useUpdater";

const project = (provider: string): ClaudeProject => ({
  name: "alpha",
  path: "/p/alpha",
  actual_path: "/home/alpha",
  session_count: 1,
  message_count: 1,
  last_modified: "",
  provider,
});

const pristine = useAppStore.getState();

const flagsFor = (view: View, loading: Partial<UseAnalyticsReturn["computed"]> = {}) =>
  ({
    isMessagesView: view === "conversation",
    isAnalyticsView: view === "analytics",
    isGlobalStatsView: view === "globalStats",
    isAnalyticsOverview: view === "analytics",
    isAnalyticsTokens: false,
    isRecentEditsView: view === "edits",
    isBoardView: view === "board",
    isSettingsView: view === "settingsManager",
    isArchiveView: view === "archive",
    isEmptyView: view === "empty",
    hasAnyError: false,
    isLoadingAnalytics: false,
    isLoadingTokenStats: false,
    isLoadingRecentEdits: false,
    isAnyLoading: false,
    ...loading,
  }) satisfies UseAnalyticsReturn["computed"];

function renderTabs(
  view: View,
  provider: string,
  loading: Partial<UseAnalyticsReturn["computed"]> = {}
) {
  useAppStore.setState(pristine, true);
  useAppStore.setState({ view, selectedProject: project(provider), selectedSession: null });
  render(
    <TooltipProvider>
      <Header
        analyticsActions={{} as UseAnalyticsReturn["actions"]}
        analyticsComputed={flagsFor(view, loading)}
        updater={{} as UseUpdaterReturn}
      />
    </TooltipProvider>
  );
  return screen.getByRole("tablist");
}

describe("header view tabs characterization", () => {
  beforeEach(() => {
    useAppStore.setState(pristine, true);
  });

  it("claude project, analytics selected", () => {
    expect(renderTabs("analytics", "claude")).toMatchSnapshot();
  });

  it("non-claude project: board is disabled with the claude-only label", () => {
    expect(renderTabs("conversation", "codex")).toMatchSnapshot();
  });

  it("loading analytics, token stats and recent edits", () => {
    expect(
      renderTabs("conversation", "claude", {
        isLoadingAnalytics: true,
        isLoadingTokenStats: true,
        isLoadingRecentEdits: true,
      })
    ).toMatchSnapshot();
  });
});
