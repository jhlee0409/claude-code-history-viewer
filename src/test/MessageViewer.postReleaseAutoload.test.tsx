/**
 * The real MessageViewer, virtualizer, wheel transaction and app store, with
 * only the backend transport, the OverlayScrollbars DOM boundary and unrelated
 * renderers replaced. An owned wheel physically releases its viewport without
 * a native scroll notification; the existing near-top autoload must still run.
 */
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClaudeMessage, ClaudeSession, MessagePage } from "@/types";

const dom = vi.hoisted(() => ({ viewport: null as HTMLElement | null, attach: null as ((node: HTMLElement) => void) | null }));

vi.mock("../utils/platform", async (importOriginal) => ({
  ...await importOriginal<typeof import("../utils/platform")>(),
  isTauri: () => false,
  getApiBase: () => "http://fixture.local",
}));

// OverlayScrollbars' viewport is a real element that holds the rows, so the
// transaction's connected-box coverage and native scroll events are actual DOM.
vi.mock("overlayscrollbars-react", () => ({
  OverlayScrollbarsComponent: React.forwardRef(function MockOverlayScrollbars(
    props: { children?: React.ReactNode; events?: { initialized?: () => void } },
    ref: React.Ref<unknown>,
  ) {
    const viewport = React.useRef<HTMLDivElement | null>(null);
    React.useImperativeHandle(ref, () => ({
      osInstance: () => (viewport.current ? { elements: () => ({ viewport: viewport.current }) } : null),
    }));
    const { initialized } = props.events ?? {};
    React.useEffect(() => { initialized?.(); }, [initialized]);
    return React.createElement("div", {
      ref: (node: HTMLDivElement | null) => {
        viewport.current = node;
        if (node && dom.viewport !== node) { dom.viewport = node; dom.attach?.(node); }
      },
      "data-testid": "transcript-viewport",
    }, props.children);
  }),
}));

vi.mock("@/components/MessageViewer/hooks/useScrollNavigation", () => ({
  useScrollNavigation: ({ selectedSessionId }: { selectedSessionId?: string }) => ({
    showScrollToTop: false,
    showScrollToBottom: false,
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollReadyForSessionId: selectedSessionId ?? null,
  }),
}));
vi.mock("@/components/MessageViewer/hooks/usePromptJump", () => ({ usePromptJump: () => {} }));
vi.mock("@/hooks/useExport", () => ({ useExport: () => ({ isExporting: false, exportConversation: vi.fn() }) }));
vi.mock("@/hooks/useCapturePreview", () => ({
  useCapturePreview: () => ({
    previewDataUrl: null, previewWidth: 0, previewHeight: 0,
    captureAndPreview: vi.fn(), savePreview: vi.fn(), discardPreview: vi.fn(),
  }),
}));
vi.mock("@/components/MessageViewer/components/CurrentDateBar", () => ({ CurrentDateBar: () => null }));
vi.mock("@/components/MessageViewer/components/CaptureModeToolbar", () => ({ CaptureModeToolbar: () => null }));
vi.mock("@/components/MessageViewer/components/FilterToolbar", () => ({ FilterToolbar: () => null }));
vi.mock("@/components/MessageViewer/components/OffScreenCaptureRenderer", () => ({
  OffScreenCaptureRenderer: React.forwardRef(() => null),
}));
vi.mock("@/components/MessageViewer/components/ScreenshotPreviewModal", () => ({ ScreenshotPreviewModal: () => null }));
vi.mock("@/components/MessageViewer/components/SessionMinimap", () => ({ MINIMAP_WIDTH_PX: 0, SessionMinimap: () => null }));
// Content renderers are out of scope: each row keeps the real row geometry
// contract (data-index, absolute translateY) with a DOM height equal to the
// production estimate, so anchor arithmetic is not disturbed by resizes.
vi.mock("@/components/MessageViewer/components/VirtualizedMessageRow", async () => {
  const { estimateMessageHeight } = await vi.importActual<
    typeof import("@/components/MessageViewer/helpers/heightEstimation")
  >("@/components/MessageViewer/helpers/heightEstimation");
  return {
    VirtualizedMessageRow: React.forwardRef(function Row(
      props: {
        virtualRow: { index: number; start: number };
        item: Parameters<typeof estimateMessageHeight>[0];
        translateOffset: number;
        isInSubagent?: boolean;
      },
      ref: React.Ref<HTMLDivElement>,
    ) {
      const { virtualRow, item, translateOffset, isInSubagent } = props;
      return React.createElement("div", {
        ref,
        "data-index": virtualRow.index,
        "data-uuid": item.type === "message" ? item.message.uuid : undefined,
        "data-height": estimateMessageHeight(item, isInSubagent),
        style: { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start - translateOffset}px)` },
      });
    }),
  };
});

const VIEWPORT_HEIGHT = 671;
const session = (id: string): ClaudeSession => ({
  session_id: id,
  actual_session_id: id,
  file_path: `/fixture/${id}.jsonl`,
  project_name: "fixture",
  provider: "claude",
  message_count: 1000,
  first_message_time: "",
  last_message_time: "",
  last_modified: "",
  has_tool_use: false,
  has_errors: false,
});
const records = (target: ClaudeSession): ClaudeMessage[] =>
  Array.from({ length: target.message_count }, (_, i) => ({
    uuid: `${target.session_id}-${i}`,
    sessionId: target.session_id,
    role: "user",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: `message ${i}`,
  }));
type PageArgs = { sessionPath: string; offset: number; limit: number };

function transport(sessions: ClaudeSession[]) {
  const fixtures = new Map(sessions.map((s) => [s.file_path, records(s)]));
  const requests: { args: PageArgs; reply: () => Promise<void> }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith("/get_session_subagents")) return Promise.resolve(new Response("[]"));
    expect(url).toBe("http://fixture.local/api/load_provider_messages_paginated");
    const args = JSON.parse(init.body as string) as PageArgs;
    return new Promise<Response>((resolve) => {
      requests.push({ args, reply: async () => {
        const all = fixtures.get(args.sessionPath)!;
        const end = all.length - args.offset;
        const start = Math.max(0, end - args.limit);
        const page: MessagePage = { messages: all.slice(start, end), next_offset: all.length - start,
          total_count: all.length, has_more: start > 0 };
        await act(async () => { resolve(new Response(JSON.stringify(page))); });
      } });
    });
  }));
  return requests;
}

function geometry() {
  const viewport = () => dom.viewport!;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const rect = (top: number, height: number) =>
      ({ x: 0, y: top, top, bottom: top + height, left: 0, right: 1000, width: 1000, height, toJSON() {} });
    if (this === dom.viewport) return rect(0, VIEWPORT_HEIGHT);
    if (this.dataset.index === undefined) return rect(0, 0);
    const translate = Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0);
    return rect(translate - viewport().scrollTop, this.getAttribute("aria-hidden") === "true" ? 0 : Number(this.dataset.height));
  });
}

function frames() {
  let next = 0;
  const queued = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { queued.set(++next, callback); return next; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { queued.delete(id); });
  // Browser rAF reports uncaught exceptions globally, not to its caller.
  return () => act(() => {
    const ready = [...queued.values()];
    queued.clear();
    for (const callback of ready) {
      try { callback(performance.now()); }
      catch (error) { if (window.dispatchEvent(new ErrorEvent("error", { error, cancelable: true }))) throw error; }
    }
  });
}

async function viewerFixture(sessions = [session("current")]) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const requests = transport(sessions);
  geometry();
  const frame = frames();
  const { MessageViewer } = await import("@/components/MessageViewer/MessageViewer");
  const { useAppStore: store } = await import("@/store/useAppStore");
  const releases: number[] = [];
  function Host() {
    const messages = store((s) => s.messages);
    const selectedSession = store((s) => s.selectedSession);
    const isLoading = store((s) => s.isLoading);
    const sessionSearch = store((s) => s.sessionSearch);
    if (!selectedSession) return null;
    return (
      <MessageViewer messages={messages} isLoading={isLoading} selectedSession={selectedSession}
        sessionSearch={sessionSearch} onSearchChange={vi.fn()} onFilterTypeChange={vi.fn()}
        onClearSearch={vi.fn()} onNextMatch={vi.fn()} onPrevMatch={vi.fn()} />
    );
  }
  const open = async (target: ClaudeSession) => {
    const before = requests.length;
    let opening!: Promise<boolean>;
    await act(async () => { opening = store.getState().navigate({ session: target }); });
    await vi.waitFor(() => expect(requests).toHaveLength(before + 1));
    expect(requests[before]!.args).toMatchObject({ sessionPath: target.file_path, offset: 0 });
    await requests[before]!.reply();
    await act(async () => { await opening; });
  };
  const sizerHeight = () => parseFloat(dom.viewport?.querySelector<HTMLElement>('div[style*="position: relative"]')?.style.height ?? "0");
  dom.attach = (node) => {
    Object.defineProperties(node, {
      clientHeight: { value: VIEWPORT_HEIGHT }, offsetHeight: { value: VIEWPORT_HEIGHT }, offsetWidth: { value: 1000 },
      scrollHeight: { configurable: true, get: () => sizerHeight() },
    });
    node.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options !== "object") return;
      releases.push(options.top ?? node.scrollTop);
      node.scrollTop = options.top ?? node.scrollTop;
    });
  };
  await open(sessions[0]!);
  const view = render(<Host />);
  // The OverlayScrollbars element becomes available after the first commit.
  await act(async () => {});
  // A loading state can remount the OverlayScrollbars viewport.
  const current = () => dom.viewport!;
  expect(current().querySelectorAll("[data-index]").length).toBeGreaterThan(0);
  // Mount-time programmatic writes are not wheel releases.
  releases.length = 0;
  const native = (scrollTop: number) => act(() => {
    current().scrollTop = scrollTop;
    current().dispatchEvent(new Event("scroll"));
  });
  const dispatchWheel = (deltaY: number) => {
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
    act(() => { current().dispatchEvent(event); });
    return event;
  };
  const wheel = (deltaY: number) => { const event = dispatchWheel(deltaY); frame(); return event; };
  const olderRequests = () => requests.filter((request) => request.args.offset > 0);
  return { store, view, get viewport() { return current(); }, requests, olderRequests, releases, native, wheel, dispatchWheel, frame, open, sizerHeight };
}

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState(null, "", "/");
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  dom.viewport = null;
  dom.attach = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("loads the earlier page once after an owned wheel releases near the top without a native scroll", async () => {
  const f = await viewerFixture();
  f.native(1000);
  expect(f.olderRequests()).toHaveLength(0);

  const event = f.wheel(-900);
  expect(event.defaultPrevented, "the transcript owns this wheel").toBe(true);
  expect(f.releases, "one physical release, without a native scroll echo").toHaveLength(1);
  expect(f.viewport.scrollTop).toBeLessThan(300);
  await act(async () => {});

  expect(f.olderRequests(), "existing near-top autoload page request").toHaveLength(1);
  expect(f.olderRequests()[0]!.args).toMatchObject({ offset: 200, limit: 200 });
  await f.olderRequests()[0]!.reply();
  expect(f.store.getState().messages).toHaveLength(400);
});

// Prepend anchoring keeps the anchored row on screen: the restored offset
// minus the height added above it is the scroll offset at anchor capture.
function loadNearTop(f: Awaited<ReturnType<typeof viewerFixture>>) {
  f.native(1000);
  const diagnostic = () => JSON.stringify({ top: f.viewport.scrollTop, height: f.viewport.scrollHeight, sizer: f.sizerHeight(), rows: f.viewport.querySelectorAll("[data-index]").length, messages: f.store.getState().messages.length });
  const event = f.wheel(-900);
  expect(event.defaultPrevented, diagnostic()).toBe(true);
  const captured = f.viewport.scrollTop;
  expect(captured).toBeLessThan(300);
  return { captured, height: f.sizerHeight() };
}
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

it("keeps the existing native near-top scroll fallback as one request", async () => {
  const f = await viewerFixture();
  f.native(1000);
  f.native(120);
  await tick();
  expect(f.olderRequests()).toHaveLength(1);
});

it("(a) ignores a native scroll echo in a later task after the release signal", async () => {
  const f = await viewerFixture();
  const before = loadNearTop(f);
  await tick();
  f.native(f.viewport.scrollTop);
  await tick();
  expect(f.olderRequests()).toHaveLength(1);
  await f.olderRequests()[0]!.reply();
  await tick();
  expect(f.olderRequests(), "page requests").toHaveLength(1);
  expect(f.viewport.scrollTop - (f.sizerHeight() - before.height), "first anchor").toBeCloseTo(before.captured, 6);
});

it("(b) starts one page and keeps the first anchor for two signals before the queued job starts", async () => {
  const f = await viewerFixture();
  const before = loadNearTop(f);
  // Conservative fixture ordering, not a browser claim: a second near-top
  // signal arrives before the store's queued page job has started.
  f.native(250);
  await tick();
  expect(f.olderRequests()).toHaveLength(1);
  await f.olderRequests()[0]!.reply();
  await tick();
  expect.soft(f.viewport.scrollTop - (f.sizerHeight() - before.height), "first anchor").toBeCloseTo(before.captured, 6);
  expect.soft(f.olderRequests(), "page requests").toHaveLength(1);
});

it("(c) ignores a native echo that arrives after the page response", async () => {
  const f = await viewerFixture();
  const before = loadNearTop(f);
  await tick();
  await f.olderRequests()[0]!.reply();
  await tick();
  const restored = f.viewport.scrollTop;
  f.native(restored);
  await tick();
  expect(f.olderRequests(), "page requests").toHaveLength(1);
  expect(restored - (f.sizerHeight() - before.height), "first anchor").toBeCloseTo(before.captured, 6);
});

it("applies the same restoring check to a release during the prepend restore", async () => {
  const f = await viewerFixture();
  loadNearTop(f);
  await tick();
  await f.olderRequests()[0]!.reply();
  expect(f.wheel(-(f.viewport.scrollTop - 100)).defaultPrevented).toBe(true);
  expect(f.viewport.scrollTop).toBeLessThan(300);
  await tick();
  expect(f.olderRequests()).toHaveLength(1);
});

it("does not request when no earlier page remains", async () => {
  const f = await viewerFixture();
  act(() => { f.store.setState({ pagination: { ...f.store.getState().pagination, hasMore: false } }); });
  loadNearTop(f);
  await tick();
  expect(f.olderRequests()).toHaveLength(0);
});

it("lets a newly opened session load while the previous session's page is still in flight", async () => {
  const first = session("current");
  const second = session("successor");
  const f = await viewerFixture([first, second]);
  loadNearTop(f);
  await tick();
  expect(f.olderRequests()).toHaveLength(1);
  await f.open(second);
  await tick();
  loadNearTop(f);
  await tick();
  // The successor page is queued behind the stale one in the store.
  await f.olderRequests()[0]!.reply();
  await tick();
  const successor = f.olderRequests().filter((request) => request.args.sessionPath === second.file_path);
  expect(successor, "successor page request").toHaveLength(1);
  await successor[0]!.reply();
  await tick();
  expect(f.store.getState().messages).toHaveLength(400);
  expect(f.store.getState().messages[0]!.uuid.startsWith("successor-")).toBe(true);
});
