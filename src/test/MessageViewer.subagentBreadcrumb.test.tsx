/**
 * The "Back to parent session" control of a subagent transcript (#772).
 *
 * A subagent with no loadable messages used to return the empty state before
 * the control rendered, so the user had no way back to the parent session.
 * The control must show with the empty state whenever a parent session is on
 * the stack, never without one, and keep working for non-empty transcripts.
 *
 * MessageViewer's heavy collaborators (virtualization, scroll navigation,
 * OverlayScrollbars, export, capture) are stubbed, as in
 * `MessageViewer.minimap.test.tsx`; only its own JSX is under test.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageViewer } from "@/components/MessageViewer/MessageViewer";
import type { ClaudeMessage, ClaudeSession } from "@/types";
import type { SearchState } from "@/store/slices/types";

const { storeState } = vi.hoisted(() => ({
  storeState: {} as Record<string, unknown>,
}));

const PARENT_SESSION = {
  session_id: "parent-1",
  actual_session_id: "parent-1",
  project_name: "proj",
  file_path: "/tmp/parent-1.jsonl",
} as unknown as ClaudeSession;

const SUBAGENT_SESSION = {
  session_id: "agent-1",
  actual_session_id: "agent-1",
  summary: "Audit the release notes",
  project_name: "proj",
  file_path: "/tmp/parent-1/subagents/agent-1.jsonl",
} as unknown as ClaudeSession;

function resetStoreState() {
  Object.keys(storeState).forEach((key) => delete storeState[key]);
  Object.assign(storeState, {
    // The raw loaded window (the paging counter reads it).
    messages: [],
    isCaptureMode: false,
    isMinimapOpen: false,
    hiddenMessageIds: [] as string[],
    selectedMessageIds: [] as string[],
    enterCaptureMode: vi.fn(),
    hideMessage: vi.fn(),
    showMessage: vi.fn(),
    restoreMessages: vi.fn(),
    isCapturing: false,
    handleSelectionClick: vi.fn(),
    clearSelection: vi.fn(),
    targetMessageUuid: null,
    shouldHighlightTarget: false,
    clearTargetMessage: vi.fn(),
    navigateToMessage: vi.fn(),
    messageFilter: {
      roles: { user: true, assistant: true },
      contentTypes: {
        text: true,
        thinking: true,
        toolCalls: true,
        commands: true,
        parallelTasks: true,
      },
    },
    subagentSessions: [],
    parentSessionStack: [] as ClaudeSession[],
    navigateToSubagent: vi.fn(),
    navigateBackToParent: vi.fn().mockResolvedValue(undefined),
    isLoadingMessages: false,
    setActiveSessionNearBottom: vi.fn(),
    setIsCapturing: vi.fn(),
    pagination: {
      hasMore: false,
      isLoadingMore: false,
      pageSize: 200,
      totalCount: 0,
      currentOffset: 0,
    },
    loadMoreMessages: vi.fn(),
    ensureMessageLoaded: vi.fn(),
    fetchFullSessionMessages: vi.fn().mockResolvedValue([]),
    setVisibleMessageUuid: vi.fn(),
  });
}

vi.mock("@/store/useAppStore", () => {
  const useAppStoreMock = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState;
  useAppStoreMock.getState = () => storeState;
  useAppStoreMock.subscribe = vi.fn(() => () => {});
  return { useAppStore: useAppStoreMock };
});

vi.mock("@/store/expandRegistryStore", () => ({
  useExpandRegistry: (selector: (s: { clearAll: () => void }) => unknown) =>
    selector({ clearAll: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const fakeViewport = document.createElement("div");

vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: React.forwardRef(function MockOverlayScrollbarsComponent(
    props: { className?: string; children?: React.ReactNode; events?: { initialized?: () => void } },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      osInstance: () => ({ elements: () => ({ viewport: fakeViewport }) }),
    }));
    React.useEffect(() => {
      props.events?.initialized?.();
    }, [props.events]);
    return React.createElement("div", { className: props.className }, props.children);
  }),
}));

vi.mock("@/hooks/useExport", () => ({
  useExport: () => ({ isExporting: false, exportConversation: vi.fn() }),
}));

vi.mock("@/hooks/useCapturePreview", () => ({
  useCapturePreview: () => ({
    previewDataUrl: null,
    previewWidth: 0,
    previewHeight: 0,
    captureAndPreview: vi.fn(),
    savePreview: vi.fn(),
    discardPreview: vi.fn(),
  }),
}));

vi.mock("@/components/MessageViewer/hooks/useSearchState", () => ({
  useSearchState: () => ({
    searchQuery: "",
    isSearchPending: false,
    handleSearchInput: vi.fn(),
    handleClearSearch: vi.fn(),
  }),
}));

vi.mock("@/components/MessageViewer/hooks/useScrollNavigation", () => ({
  useScrollNavigation: () => ({
    showScrollToTop: false,
    showScrollToBottom: false,
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollReadyForSessionId: "agent-1",
  }),
}));

vi.mock("@/components/MessageViewer/hooks/usePromptJump", () => ({
  usePromptJump: () => {},
}));

const SAMPLE_MESSAGE = {
  uuid: "m1",
  type: "user",
  role: "user",
  timestamp: "2026-09-26T06:29:32.477Z",
  content: "hello",
  isSidechain: true,
} as unknown as ClaudeMessage;

vi.mock("@/components/MessageViewer/hooks/useMessageVirtualization", () => ({
  useMessageVirtualization: () => ({
    virtualizer: {
      measurementsCache: [],
      getTotalSize: () => 0,
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
      getOffsetForIndex: vi.fn(() => [0, "start"] as const),
      getVirtualItems: () => [],
    },
    flattenedMessages: [],
    uuidToIndexMap: new Map(),
    virtualRows: [],
    totalSize: 0,
    getScrollIndex: vi.fn(() => null),
    rowTranslateOffset: 0,
  }),
}));

vi.mock("@/components/MessageViewer/components/CurrentDateBar", () => ({ CurrentDateBar: () => null }));
vi.mock("@/components/MessageViewer/components/CaptureModeToolbar", () => ({ CaptureModeToolbar: () => null }));
vi.mock("@/components/MessageViewer/components/FilterToolbar", () => ({ FilterToolbar: () => null }));
vi.mock("@/components/MessageViewer/components/OffScreenCaptureRenderer", () => ({
  OffScreenCaptureRenderer: React.forwardRef(() => null),
}));
vi.mock("@/components/MessageViewer/components/ScreenshotPreviewModal", () => ({ ScreenshotPreviewModal: () => null }));
vi.mock("@/components/MessageViewer/components/VirtualizedMessageRow", () => ({
  VirtualizedMessageRow: React.forwardRef(() => null),
}));
vi.mock("@/components/MessageViewer/components/SessionMinimap", () => ({
  MINIMAP_WIDTH_PX: 24,
  SessionMinimap: () => null,
}));

const SEARCH: SearchState = {
  query: "",
  matches: [],
  currentMatchIndex: -1,
  isSearching: false,
  filterType: "content",
  results: [],
};

function renderViewer(messages: ClaudeMessage[], session: ClaudeSession = SUBAGENT_SESSION) {
  return render(
    <MessageViewer
      messages={messages}
      isLoading={false}
      selectedSession={session}
      sessionSearch={SEARCH}
      onSearchChange={vi.fn()}
      onFilterTypeChange={vi.fn()}
      onClearSearch={vi.fn()}
      onNextMatch={vi.fn()}
      onPrevMatch={vi.fn()}
    />,
  );
}

const backControl = () => screen.queryByRole("button", { name: "renderers.agentTool.backToParent" });

beforeEach(() => {
  resetStoreState();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MessageViewer: return to the parent session from a subagent (#772)", () => {
  it("shows the empty state and the return control for a subagent with no loadable messages", () => {
    storeState.parentSessionStack = [PARENT_SESSION];
    renderViewer([]);

    expect(screen.getByText("messageViewer.noMessages")).toBeTruthy();
    expect(backControl()).not.toBeNull();
    // The bar names the subagent it returns from.
    expect(screen.getByText("Audit the release notes")).toBeTruthy();
  });

  it("returns to the parent session when the control in the empty view is activated", () => {
    storeState.parentSessionStack = [PARENT_SESSION];
    renderViewer([]);

    fireEvent.click(backControl() as HTMLElement);

    expect(storeState.navigateBackToParent).toHaveBeenCalledTimes(1);
  });

  it("shows no return control in an empty view without a parent session", () => {
    renderViewer([], PARENT_SESSION);

    expect(screen.getByText("messageViewer.noMessages")).toBeTruthy();
    expect(backControl()).toBeNull();
  });

  it("keeps the return control working for a subagent with messages", () => {
    storeState.parentSessionStack = [PARENT_SESSION];
    renderViewer([SAMPLE_MESSAGE]);

    expect(screen.queryByText("messageViewer.noMessages")).toBeNull();
    fireEvent.click(backControl() as HTMLElement);

    expect(storeState.navigateBackToParent).toHaveBeenCalledTimes(1);
  });
});
