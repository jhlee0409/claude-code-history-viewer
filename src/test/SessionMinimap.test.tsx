import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Virtualizer, VirtualItem } from "@tanstack/react-virtual";
import { SessionMinimap } from "@/components/MessageViewer/components/SessionMinimap";
import { minimapScale, scrollTopForStripY, viewportBox } from "@/components/MessageViewer/helpers/minimapLayout";
import type { FlattenedMessage, FlattenedMessageItem } from "@/components/MessageViewer/types";
import type { ClaudeMessage } from "@/types";

/** Mirrors `messageKinds.test.ts`'s fixture builder. */
const makeMessage = (overrides: Record<string, unknown>): ClaudeMessage =>
  ({
    uuid: "message",
    type: "user",
    role: "user",
    timestamp: "2026-09-26T06:29:32.477Z",
    content: "",
    ...overrides,
  }) as unknown as ClaudeMessage;

const flattenedItem = (
  message: ClaudeMessage,
  overrides: Partial<FlattenedMessageItem> = {},
): FlattenedMessageItem => ({
  type: "message",
  message,
  depth: 0,
  originalIndex: 0,
  isGroupLeader: false,
  isGroupMember: false,
  isProgressGroupLeader: false,
  isProgressGroupMember: false,
  isTaskOperationGroupLeader: false,
  isTaskOperationGroupMember: false,
  isContinuation: false,
  ...overrides,
});

const SAMPLE_FLATTENED: FlattenedMessage[] = [
  flattenedItem(makeMessage({ uuid: "p1", type: "user", content: "a typed prompt" })),
  flattenedItem(makeMessage({ uuid: "r1", type: "assistant", content: [{ type: "text", text: "a reply" }] })),
  flattenedItem(makeMessage({ uuid: "t1", type: "user", toolUseResult: { stdout: "ok" }, content: "" })),
];

const SAMPLE_MEASUREMENTS = [
  { start: 0, size: 100 },
  { start: 100, size: 100 },
  { start: 200, size: 100 },
];
const SAMPLE_TOTAL_SIZE = 300;

const STRIP_WIDTH = 14;
const STRIP_HEIGHT = 200;

/** A fake scroll element: the shape `getScrollElement()` resolves to, plus a way to fire "scroll". */
function makeScrollElement(overrides: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {}) {
  const listeners = new Set<EventListener>();
  const el = {
    scrollTop: overrides.scrollTop ?? 0,
    clientHeight: overrides.clientHeight ?? 400,
    scrollHeight: overrides.scrollHeight ?? 4000,
    addEventListener: vi.fn((type: string, cb: EventListener) => {
      if (type === "scroll") listeners.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: EventListener) => {
      if (type === "scroll") listeners.delete(cb);
    }),
    dispatchScroll() {
      listeners.forEach((cb) => cb(new Event("scroll")));
    },
  };
  return el;
}

function makeVirtualizer(measurements = SAMPLE_MEASUREMENTS, totalSize = SAMPLE_TOTAL_SIZE) {
  return {
    measurementsCache: measurements,
    getTotalSize: () => totalSize,
  } as unknown as Virtualizer<HTMLElement, Element>;
}

/**
 * A `requestAnimationFrame` queue the test controls directly, rather than an
 * always-synchronous stub: a frame stays pending until `flush()` runs it, so
 * the unmount test can assert `cancelAnimationFrame` fired on a frame that
 * genuinely had not run yet.
 */
function installControllableRAF() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const raf = vi.fn((cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  const caf = vi.fn((handle: number) => {
    pending.delete(handle);
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
  return {
    raf,
    caf,
    flush() {
      const callbacks = Array.from(pending.values());
      pending.clear();
      callbacks.forEach((cb) => cb(performance.now()));
    },
    pendingCount() {
      return pending.size;
    },
  };
}

/** Stubs `getComputedStyle` so every CSS custom property resolves to a non-empty, distinguishable string. */
function stubComputedStyle() {
  return vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) => `resolved(${name})`,
      }) as CSSStyleDeclaration,
  );
}

function installCanvasContextMock() {
  const ctx = {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

let originalClientWidth: PropertyDescriptor | undefined;
let originalClientHeight: PropertyDescriptor | undefined;

beforeEach(() => {
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => STRIP_WIDTH,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => STRIP_HEIGHT,
  });
});

afterEach(() => {
  // jsdom defines these on `Element.prototype`, not `HTMLElement.prototype`,
  // so the "original" descriptor read above is `undefined`; restore by
  // removing the override rather than reinstalling a descriptor that was
  // never there, so the next test file sees jsdom's own getter again.
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).clientWidth;
  }
  if (originalClientHeight) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).clientHeight;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SessionMinimap", () => {
  it("draws the session as colored blocks", () => {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    const ctx = installCanvasContextMock();
    const virtualizer = makeVirtualizer();
    const scrollEl = makeScrollElement();

    render(
      <SessionMinimap
        virtualizer={virtualizer}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );

    rafQueue.flush();

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.setTransform).toHaveBeenCalled();
  });

  it("is aria-hidden at the root, with no tabbable descendant", () => {
    installControllableRAF();
    stubComputedStyle();
    installCanvasContextMock();
    const scrollEl = makeScrollElement();

    const { getByTestId } = render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );

    const root = getByTestId("session-minimap");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(
      root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
  });

  it("tracks the viewport box's top/height from a scroll event's scrollTop/clientHeight", () => {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    installCanvasContextMock();
    const virtualizer = makeVirtualizer();
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 400, scrollHeight: 4000 });

    const { getByTestId } = render(
      <SessionMinimap
        virtualizer={virtualizer}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );

    // Move the scroll position (as if the reader scrolled to the middle) and
    // fire the "scroll" event the component's listener is attached to. The
    // resulting `setViewport` happens inside the flushed rAF callback, not a
    // React event, so it needs its own `act` to be visible before asserting.
    act(() => {
      scrollEl.scrollTop = 1800;
      scrollEl.clientHeight = 400;
      scrollEl.dispatchScroll();
      rafQueue.flush();
    });

    const viewport = getByTestId("session-minimap-viewport");
    const scale = minimapScale(scrollEl.scrollHeight, STRIP_HEIGHT);
    const expected = viewportBox(1800, 400, scale);

    expect(viewport.style.top).toBe(`${expected.top}px`);
    expect(viewport.style.height).toBe(`${expected.height}px`);
  });

  it("keeps tracking scroll after totalSize changes while a frame is pending (regression)", () => {
    // A dynamic row-height remeasurement changes `totalSize` constantly while
    // scrolling. If that re-run's cleanup cancels an in-flight scroll frame
    // before its callback can clear the "pending" flag, and that flag is a
    // ref shared across effect runs rather than scoped to one, every later
    // scroll early-returns forever: the box goes dead until unmount.
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    installCanvasContextMock();
    const virtualizer = makeVirtualizer();
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 400, scrollHeight: 4000 });

    const renderWithTotalSize = (totalSize: number) => (
      <SessionMinimap
        virtualizer={virtualizer}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={totalSize}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />
    );

    const { rerender, getByTestId } = render(renderWithTotalSize(SAMPLE_TOTAL_SIZE));

    // Scroll once but do not flush: a frame is now in flight.
    act(() => {
      scrollEl.scrollTop = 900;
      scrollEl.dispatchScroll();
    });

    // `totalSize` changes mid-scroll, re-running the scroll effect; its
    // cleanup cancels the still-pending frame above.
    act(() => {
      rerender(renderWithTotalSize(SAMPLE_TOTAL_SIZE + 1));
    });

    // A later scroll must still move the box.
    act(() => {
      scrollEl.scrollTop = 1800;
      scrollEl.dispatchScroll();
      rafQueue.flush();
    });

    const viewport = getByTestId("session-minimap-viewport");
    const scale = minimapScale(scrollEl.scrollHeight, STRIP_HEIGHT);
    const expected = viewportBox(1800, 400, scale);
    expect(viewport.style.top).toBe(`${expected.top}px`);
  });

  it("centers the list on the clicked point, without navigateToMessage/scrollToIndex", () => {
    installControllableRAF();
    stubComputedStyle();
    installCanvasContextMock();
    const virtualizer = makeVirtualizer();
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 400, scrollHeight: 4000 });

    const { getByTestId } = render(
      <SessionMinimap
        virtualizer={virtualizer}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );

    const root = getByTestId("session-minimap");
    // jsdom's default `getBoundingClientRect()` is all zeros, so `clientY` is
    // the strip-local y-coordinate directly.
    const clickY = 50;
    root.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, clientY: clickY } as MouseEventInit),
    );

    const scale = minimapScale(scrollEl.scrollHeight, STRIP_HEIGHT);
    const expected = scrollTopForStripY(clickY, scale, scrollEl.clientHeight, scrollEl.scrollHeight);

    expect(scrollEl.scrollTop).toBe(expected);
  });

  it("maps the box against the scroll content height, so it ends at the strip's bottom with a list header", () => {
    // The virtualizer's measurements start after the list header (its
    // scrollMargin), while getTotalSize() leaves that margin out. The strip
    // must scale against the whole scroll content, or the box overruns the
    // strip at the bottom of a short session.
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    installCanvasContextMock();
    const virtualizer = makeVirtualizer(
      [
        { start: 60, size: 100 },
        { start: 160, size: 100 },
        { start: 260, size: 100 },
      ],
      300,
    );
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 120, scrollHeight: 360 });

    const { getByTestId } = render(
      <SessionMinimap
        virtualizer={virtualizer}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={300}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );

    act(() => {
      scrollEl.scrollTop = 240; // the bottom: scrollHeight - clientHeight
      scrollEl.dispatchScroll();
      rafQueue.flush();
    });

    const viewport = getByTestId("session-minimap-viewport");
    const bottom = parseFloat(viewport.style.top) + parseFloat(viewport.style.height);
    expect(bottom).toBeCloseTo(STRIP_HEIGHT, 5);
  });

  it("paints the newest rows even when a frame was already pending", () => {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    const ctx = installCanvasContextMock();
    const virtualizer = makeVirtualizer();
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 });
    const renderWith = (flattened: FlattenedMessage[]) => (
      <SessionMinimap
        virtualizer={virtualizer}
        flattenedMessages={flattened}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />
    );

    // No rows yet: the first frame, still pending, would paint nothing.
    const { rerender } = render(renderWith([]));
    act(() => {
      rerender(renderWith(SAMPLE_FLATTENED));
    });
    rafQueue.flush();

    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("reads each color once per draw, not once per painted pixel row", () => {
    const rafQueue = installControllableRAF();
    const computedStyle = stubComputedStyle();
    installCanvasContextMock();
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 });

    render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );
    computedStyle.mockClear();
    rafQueue.flush();

    // Three kinds cover all 200 pixel rows; one read per kind is enough.
    expect(computedStyle.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("cleans up its observers, scroll listener, and pending frame on unmount", () => {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    installCanvasContextMock();
    const resizeDisconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
    const mutationDisconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const scrollEl = makeScrollElement();

    const { unmount } = render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );

    // The initial draw's frame has not been flushed, so it is still pending.
    expect(rafQueue.pendingCount()).toBeGreaterThan(0);

    unmount();

    expect(rafQueue.caf).toHaveBeenCalled();
    expect(resizeDisconnect).toHaveBeenCalled();
    expect(mutationDisconnect).toHaveBeenCalled();
    expect(scrollEl.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
