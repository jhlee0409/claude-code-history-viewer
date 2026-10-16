/**
 * A tab's saved scroll anchor whose message lives in an older page: the
 * viewer asks the store to load it (`ensureMessageLoaded`). When that load
 * rejects, the anchor is dropped and the in-flight guard released, so a
 * later search match into an unloaded page still loads (PR #673 review).
 *
 * Harness: the same stubbed collaborators as `MessageViewer.minimap.test.tsx`.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { MessageViewer } from "@/components/MessageViewer/MessageViewer";
import type { ClaudeMessage, ClaudeSession } from "@/types";
import type { SearchState } from "@/store/slices/types";

// ---------------------------------------------------------------------------
// Store mock: supports both `useAppStore()` (whole state) and
// `useAppStore((s) => s.field)` (selector), plus the static `.getState()`
// a couple of effects in MessageViewer.tsx call directly.
// ---------------------------------------------------------------------------

const { storeState } = vi.hoisted(() => ({ storeState: {} as Record<string, unknown> }));

function resetStoreState() {
  Object.keys(storeState).forEach((key) => delete storeState[key]);
  Object.assign(storeState, {
    isCaptureMode: false,
    isMinimapOpen: true,
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
    parentSessionStack: [],
    navigateToSubagent: vi.fn(),
    navigateBackToParent: vi.fn(),
    isLoadingMessages: false,
    setActiveSessionNearBottom: vi.fn(),
    setIsCapturing: vi.fn(),
    pagination: {
      hasMore: false,
      isLoadingMore: false,
      pageSize: 200,
      totalCount: 1,
      currentOffset: 0,
    },
    loadMoreMessages: vi.fn(),
    ensureMessageLoaded: vi.fn(),
    fetchFullSessionMessages: vi.fn().mockResolvedValue([]),
    // Unused until the turn outline (#632) lands; its MessageViewer calls this on mount.
    setVisibleMessageUuid: vi.fn(),
  });
}

vi.mock("@/store/useAppStore", () => {
  const useAppStoreMock = (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(storeState) : storeState;
  useAppStoreMock.getState = () => storeState;
  return { useAppStore: useAppStoreMock };
});

vi.mock("@/store/expandRegistryStore", () => ({
  useExpandRegistry: (selector: (s: { clearAll: () => void }) => unknown) =>
    selector({ clearAll: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// A real DOM node stands in for OverlayScrollbars' internal viewport element,
// so `addEventListener`/`scrollTop` behave like the real thing with no
// further stubbing.
const fakeViewport = document.createElement("div");

vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: React.forwardRef(function MockOverlayScrollbarsComponent(
    props: {
      className?: string;
      children?: React.ReactNode;
      events?: { initialized?: () => void };
    },
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
    scrollReadyForSessionId: "session-1",
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
} as unknown as ClaudeMessage;

const SAMPLE_FLATTENED = [
  {
    type: "message" as const,
    message: SAMPLE_MESSAGE,
    depth: 0,
    originalIndex: 0,
    isGroupLeader: false,
    isGroupMember: false,
    isProgressGroupLeader: false,
    isProgressGroupMember: false,
    isTaskOperationGroupLeader: false,
    isTaskOperationGroupMember: false,
    isContinuation: false,
  },
];

const SAMPLE_VIRTUALIZER = {
  measurementsCache: [{ start: 0, size: 50 }],
  getTotalSize: () => 50,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  getOffsetForIndex: vi.fn(() => [0, "start"] as const),
};

// Read at render time, so a test can empty the list (as when every message is
// filtered out); `beforeEach` restores the one sample row.
let flattenedForRender: typeof SAMPLE_FLATTENED = SAMPLE_FLATTENED;

vi.mock("@/components/MessageViewer/hooks/useMessageVirtualization", () => ({
  useMessageVirtualization: () => ({
    virtualizer: SAMPLE_VIRTUALIZER,
    flattenedMessages: flattenedForRender,
    uuidToIndexMap: new Map([["m1", 0]]),
    virtualRows:
      flattenedForRender.length > 0 ? [{ key: "0", index: 0, start: 0, end: 50, size: 50, lane: 0 }] : [],
    totalSize: flattenedForRender.length > 0 ? 50 : 0,
    getScrollIndex: vi.fn(() => 0),
    rowTranslateOffset: 0,
  }),
}));

// Rendering details of these sub-components are out of scope for the gate
// this file tests; each is stubbed to a cheap no-op.
vi.mock("@/components/MessageViewer/components/CurrentDateBar", () => ({
  CurrentDateBar: () => null,
}));
vi.mock("@/components/MessageViewer/components/CaptureModeToolbar", () => ({
  CaptureModeToolbar: () => null,
}));
vi.mock("@/components/MessageViewer/components/FilterToolbar", () => ({
  FilterToolbar: () => null,
}));
vi.mock("@/components/MessageViewer/components/OffScreenCaptureRenderer", () => ({
  OffScreenCaptureRenderer: React.forwardRef(() => null),
}));
vi.mock("@/components/MessageViewer/components/ScreenshotPreviewModal", () => ({
  ScreenshotPreviewModal: () => null,
}));
vi.mock("@/components/MessageViewer/components/VirtualizedMessageRow", () => ({
  VirtualizedMessageRow: React.forwardRef(() => null),
}));

// The real `MINIMAP_WIDTH_PX` is kept (so this test fails if it ever drifts
// from what the mount site assumes); only the heavy canvas painter itself is
// replaced by a `data-testid` marker.
vi.mock("@/components/MessageViewer/components/SessionMinimap", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/MessageViewer/components/SessionMinimap")
  >("@/components/MessageViewer/components/SessionMinimap");
  return {
    MINIMAP_WIDTH_PX: actual.MINIMAP_WIDTH_PX,
    SessionMinimap: () => React.createElement("div", { "data-testid": "session-minimap" }),
  };
});


import { toast } from "sonner";

const SAMPLE_SESSION = {
  session_id: "session-1",
  project_name: "proj",
  file_path: "/tmp/session-1.jsonl",
} as unknown as ClaudeSession;

const searchAt = (messageUuid: string | null): SearchState => ({
  query: messageUuid ? "x" : "",
  matches: messageUuid ? [{ messageUuid, messageIndex: 0, matchIndex: 0, matchCount: 1 }] : [],
  currentMatchIndex: messageUuid ? 0 : -1,
  isSearching: false,
  filterType: "content",
  results: [],
}) as unknown as SearchState;

const viewer = (search: SearchState) => (
  <MessageViewer
    messages={[SAMPLE_MESSAGE]}
    isLoading={false}
    selectedSession={SAMPLE_SESSION}
    sessionSearch={search}
    onSearchChange={vi.fn()}
    onFilterTypeChange={vi.fn()}
    onClearSearch={vi.fn()}
    onNextMatch={vi.fn()}
    onPrevMatch={vi.fn()}
  />
);

const PENDING = { sessionPath: SAMPLE_SESSION.file_path, anchor: { messageUuid: "older", offset: 0 } };

beforeEach(() => {
  resetStoreState();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  flattenedForRender = SAMPLE_FLATTENED;
  Object.assign(storeState, {
    pagination: { hasMore: true, isLoadingMore: false, pageSize: 200, totalCount: 400, currentOffset: 200 },
    pendingAnchor: PENDING,
    clearPendingAnchor: vi.fn((pending: unknown) => {
      if (storeState.pendingAnchor === pending) storeState.pendingAnchor = null;
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("restoring a saved anchor whose page fails to load", () => {
  it("drops the anchor, tells the user, and frees the guard for a later search match", async () => {
    const ensure = vi.fn((uuid: string) =>
      uuid === "older" ? Promise.reject(new Error("offset lookup failed")) : Promise.resolve(true),
    );
    storeState.ensureMessageLoaded = ensure;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { rerender } = render(viewer(searchAt(null)));

    await waitFor(() => expect(storeState.clearPendingAnchor).toHaveBeenCalledWith(PENDING));
    expect(ensure).toHaveBeenCalledWith("older");
    expect(toast.error).toHaveBeenCalled();

    // A search match in an unloaded page: the guard no longer blocks it.
    rerender(viewer(searchAt("deep-match")));
    await waitFor(() => expect(ensure).toHaveBeenCalledWith("deep-match"));
  });
});
