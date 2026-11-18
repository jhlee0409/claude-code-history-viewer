/**
 * A prompt-history session (#764): a Claude Code session whose transcript is
 * gone, shown from the prompts Claude Code's `history.jsonl` kept. The viewer
 * must say that only the prompts survive, and offer no API-request view (the
 * records it reads were deleted with the transcript).
 *
 * MessageViewer's heavy collaborators are stubbed, as in
 * `MessageViewer.subagentBreadcrumb.test.tsx`; only its own JSX is under test.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageViewer } from "@/components/MessageViewer/MessageViewer";
import type { ClaudeMessage, ClaudeSession } from "@/types";
import type { SearchState } from "@/store/slices/types";

const { storeState, filterToolbarProps } = vi.hoisted(() => ({
  storeState: {} as Record<string, unknown>,
  filterToolbarProps: [] as Array<{ apiViewAvailable?: boolean }>,
}));

const TRANSCRIPT_SESSION = {
  session_id: "/home/u/.claude/projects/-a/abc.jsonl",
  actual_session_id: "abc",
  project_name: "a",
  provider: "claude",
  file_path: "/home/u/.claude/projects/-a/abc.jsonl",
} as unknown as ClaudeSession;

const PROMPT_HISTORY_SESSION = {
  session_id: "/home/u/.claude/projects/-a/def.prompt-history",
  actual_session_id: "def",
  project_name: "a",
  provider: "claude",
  storage_type: "prompt_history",
  file_path: "/home/u/.claude/projects/-a/def.prompt-history",
} as unknown as ClaudeSession;

const PROMPT = {
  uuid: "prompt-history:def:0",
  type: "user",
  role: "user",
  timestamp: "2026-01-01T00:00:00.000Z",
  content: "an old prompt",
} as unknown as ClaudeMessage;

function resetStoreState() {
  Object.keys(storeState).forEach((key) => delete storeState[key]);
  Object.assign(storeState, {
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
      totalCount: 1,
      currentOffset: 1,
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
    scrollReadyForSessionId: null,
  }),
}));

vi.mock("@/components/MessageViewer/hooks/usePromptJump", () => ({
  usePromptJump: () => {},
}));

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
vi.mock("@/components/MessageViewer/components/FilterToolbar", () => ({
  FilterToolbar: (props: { apiViewAvailable?: boolean }) => {
    filterToolbarProps.push(props);
    return null;
  },
}));
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

function renderViewer(session: ClaudeSession) {
  return render(
    <MessageViewer
      messages={[PROMPT]}
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

const lastApiViewAvailable = () => filterToolbarProps[filterToolbarProps.length - 1]?.apiViewAvailable;

beforeEach(() => {
  resetStoreState();
  filterToolbarProps.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MessageViewer: prompt history (#764)", () => {
  it("says that only the prompts of a deleted transcript are shown", () => {
    renderViewer(PROMPT_HISTORY_SESSION);

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("session.promptHistory.label");
    expect(note).toHaveTextContent("session.promptHistory.description");
  });

  it("offers no API-request view for it", () => {
    renderViewer(PROMPT_HISTORY_SESSION);

    expect(lastApiViewAvailable()).toBe(false);
  });

  it("leaves a transcript without the note and with its API-request view", () => {
    renderViewer(TRANSCRIPT_SESSION);

    expect(screen.queryByRole("note")).toBeNull();
    expect(lastApiViewAvailable()).toBe(true);
  });
});
