/**
 * Gate test for the session minimap's mount point in `MessageViewer.tsx`
 * (build steps 6, 7, 11 of `docs/specs/issue-599-session-minimap.md`).
 *
 * `MessageViewer` pulls in a large hook/component graph (virtualization,
 * search, capture mode, export, OverlayScrollbars, …) that has nothing to do
 * with the minimap gate. Per the spec's own fallback ("test the gate at the
 * smallest seam that still exercises MessageViewer's own JSX"), every one of
 * those collaborators is stubbed to a cheap no-op here, so the only real
 * logic under test is MessageViewer's own JSX: the `useMinimapVisible()`
 * check that decides whether `<SessionMinimap>` mounts and whether the
 * wrapper around it gets right-padded by `MINIMAP_WIDTH_PX`.
 *
 * `SessionMinimap` itself (canvas drawing, viewport box, drag/click) is
 * already covered by `SessionMinimap.test.tsx`; it is stubbed here too, kept
 * only as a `data-testid="session-minimap"` marker so this file can assert
 * mount/unmount without re-testing its internals.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
vi.mock("@/components/MessageViewer/components/FloatingDateOverlay", () => ({
  FloatingDateOverlay: () => null,
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

import { MINIMAP_WIDTH_PX } from "@/components/MessageViewer/components/SessionMinimap";

const SAMPLE_SESSION = {
  session_id: "session-1",
  project_name: "proj",
  file_path: "/tmp/session-1.jsonl",
} as unknown as ClaudeSession;

const SAMPLE_SEARCH: SearchState = {
  query: "",
  matches: [],
  currentMatchIndex: -1,
  isSearching: false,
  filterType: "content",
  results: [],
};

function renderViewer() {
  return render(
    <MessageViewer
      messages={[SAMPLE_MESSAGE]}
      isLoading={false}
      selectedSession={SAMPLE_SESSION}
      sessionSearch={SAMPLE_SEARCH}
      onSearchChange={vi.fn()}
      onFilterTypeChange={vi.fn()}
      onClearSearch={vi.fn()}
      onNextMatch={vi.fn()}
      onPrevMatch={vi.fn()}
    />,
  );
}

/** The wrapper `MessageViewer.tsx` pads for the strip, by its fixed class list. */
function getMinimapWrapper(container: HTMLElement) {
  return container.querySelector(".relative.flex-1.min-h-0");
}

function setMdUp(isMdUp: boolean) {
  // `useIsMdUp` is `!useIsMobile()`, and `useIsMobile` reads
  // `(max-width: 767px)` through `useMediaQuery`'s `window.matchMedia`.
  // Below `md` means that query matches.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: !isMdUp,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  resetStoreState();
  setMdUp(true);
  flattenedForRender = SAMPLE_FLATTENED;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MessageViewer minimap mount gate", () => {
  it("mounts the strip and pads the wrapper when open, not in Capture Mode, and md-up", () => {
    const { container, queryByTestId } = renderViewer();

    expect(queryByTestId("session-minimap")).not.toBeNull();
    const wrapper = getMinimapWrapper(container);
    expect(wrapper).not.toBeNull();
    expect((wrapper as HTMLElement).style.paddingRight).toBe(`${MINIMAP_WIDTH_PX}px`);
  });

  it("moves the floating scroll buttons left of the strip while it is shown", () => {
    const { getByTestId } = renderViewer();

    // 16px is the buttons' own right-4 inset, kept beside the strip.
    expect(getByTestId("message-scroll-buttons").style.right).toBe(`${MINIMAP_WIDTH_PX + 16}px`);
  });

  it("leaves the floating scroll buttons at their own inset when the strip is off", () => {
    (storeState as { isMinimapOpen: boolean }).isMinimapOpen = false;
    const { getByTestId } = renderViewer();

    expect(getByTestId("message-scroll-buttons").style.right).toBe("");
  });

  it("does not mount or pad when the switch is off", () => {
    (storeState as { isMinimapOpen: boolean }).isMinimapOpen = false;
    const { container, queryByTestId } = renderViewer();

    expect(queryByTestId("session-minimap")).toBeNull();
    const wrapper = getMinimapWrapper(container);
    expect((wrapper as HTMLElement).style.paddingRight).toBe("");
  });

  it("does not mount or pad in Capture Mode, even when the switch is on", () => {
    (storeState as { isCaptureMode: boolean }).isCaptureMode = true;
    const { container, queryByTestId } = renderViewer();

    expect(queryByTestId("session-minimap")).toBeNull();
    const wrapper = getMinimapWrapper(container);
    expect((wrapper as HTMLElement).style.paddingRight).toBe("");
  });

  it("does not mount or pad below the md breakpoint, even when the switch is on", () => {
    setMdUp(false);
    const { container, queryByTestId } = renderViewer();

    expect(queryByTestId("session-minimap")).toBeNull();
    const wrapper = getMinimapWrapper(container);
    expect((wrapper as HTMLElement).style.paddingRight).toBe("");
  });

  it("does not pad or move the scroll buttons when there are no rows to show, even when the switch is on", () => {
    flattenedForRender = [];
    const { container, queryByTestId, getByTestId } = renderViewer();

    expect(queryByTestId("session-minimap")).toBeNull();
    const wrapper = getMinimapWrapper(container);
    expect((wrapper as HTMLElement).style.paddingRight).toBe("");
    expect(getByTestId("message-scroll-buttons").style.right).toBe("");
  });
});
