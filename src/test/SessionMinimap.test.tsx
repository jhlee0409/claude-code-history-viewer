import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { Virtualizer, VirtualItem } from "@tanstack/react-virtual";
import { SessionMinimap } from "@/components/MessageViewer/components/SessionMinimap";
import {
  MINIMAP_BAND_MAX_SHARE,
  MINIMAP_BAR_PAD_PX,
  MINIMAP_CURRENT_TICK_HEIGHT_PX,
  MINIMAP_TICK_GUTTER_PX,
  MINIMAP_TICK_HEIGHT_PX,
  minimapScale,
  minimapTickX,
  scrollTopForStripY,
  viewportBox,
} from "@/components/MessageViewer/helpers/minimapLayout";
import type { FlattenedMessage, FlattenedMessageItem } from "@/components/MessageViewer/types";
import type { ClaudeMessage } from "@/types";

// Keys come back as themselves; a count is appended so plural strings are checkable.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

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

const STRIP_WIDTH = 48;
const STRIP_HEIGHT = 200;

/** A fake scroll element: the shape `getScrollElement()` resolves to, plus a way to fire "scroll". */
function makeScrollElement(
  overrides: { scrollTop?: number; clientHeight?: number; scrollHeight?: number; listTop?: number } = {},
) {
  const listeners = new Set<EventListener>();
  // A rendered row whose parent is the virtual list, `listTop` px below the
  // scroll content's top; omitted, no row is rendered.
  const row =
    overrides.listTop === undefined
      ? null
      : { parentElement: { getBoundingClientRect: () => ({ top: overrides.listTop }) } };
  const el = {
    scrollTop: overrides.scrollTop ?? 0,
    clientHeight: overrides.clientHeight ?? 400,
    scrollHeight: overrides.scrollHeight ?? 4000,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector: vi.fn(() => row),
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
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      paints.push({ x, y, w, h, alpha: ctx.globalAlpha, fill: ctx.fillStyle });
    }),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: "",
    globalAlpha: 1,
  };
  // Each fillRect with the globalAlpha in force when it ran.
  const paints: { x: number; y: number; w: number; h: number; alpha: number; fill: string }[] = [];
  Object.assign(ctx, { paints });
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

  it("paints every bar from the left pad and leaves the right tick gutter empty", () => {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    const ctx = installCanvasContextMock() as ReturnType<typeof installCanvasContextMock> & {
      paints: { x: number; w: number }[];
    };
    const scrollEl = makeScrollElement({ scrollHeight: SAMPLE_TOTAL_SIZE });

    render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );
    rafQueue.flush();

    expect(ctx.paints.length).toBeGreaterThan(0);
    for (const paint of ctx.paints) {
      expect(paint.x).toBe(MINIMAP_BAR_PAD_PX);
      expect(paint.x + paint.w).toBeLessThanOrEqual(STRIP_WIDTH - MINIMAP_TICK_GUTTER_PX);
    }
  });

  it("paints the prompt at full strength and dims the reply and tool rows", () => {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    const ctx = installCanvasContextMock() as ReturnType<typeof installCanvasContextMock> & {
      paints: { y: number; alpha: number }[];
    };
    const scrollEl = makeScrollElement({ scrollHeight: SAMPLE_TOTAL_SIZE });

    render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );
    rafQueue.flush();

    // The three sample rows each cover a third of the 200px strip: prompt, reply, tool.
    const alphaAt = (y: number) => ctx.paints.find((paint) => paint.y === y)?.alpha;
    expect(alphaAt(10)).toBe(1);
    expect(alphaAt(100)).toBeLessThan(1);
    expect(alphaAt(180)).toBeLessThan(alphaAt(100) ?? 1);
    // Leaves the context as it found it for anything drawn afterwards.
    expect(ctx.globalAlpha).toBe(1);
  });

  it("gives the strip a background and left border, and the viewport box top and bottom edges", () => {
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

    expect(getByTestId("session-minimap").className).toMatch(/\bborder-l\b/);
    expect(getByTestId("session-minimap").className).toMatch(/\bbg-/);
    expect(getByTestId("session-minimap-viewport").className).toMatch(/\bborder-y\b/);
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

  it("shifts the blocks down when content above the list is not in the scroll margin", () => {
    // A dev-only debug panel (or a "no results" notice) sits above the list
    // inside the scroll container; the measurements still start at 0.
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    const ctx = installCanvasContextMock();
    const scrollEl = makeScrollElement({ scrollTop: 0, clientHeight: 400, scrollHeight: 400, listTop: 100 });

    render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
      />,
    );
    rafQueue.flush();

    // 100 px above the list on a 400 px content mapped to 200 px: rows start at y=50.
    const ys = ctx.fillRect.mock.calls.map((call) => call[1] as number);
    expect(Math.min(...ys)).toBe(50);
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

describe("SessionMinimap PR 2: not-loaded band, search ticks, hover previews", () => {
  type Paint = { x: number; y: number; w: number; h: number; alpha: number; fill: string };

  /** 8,215 of 8,415 unloaded: far over the cap, so the band is a quarter of the strip. */
  const LONG_SESSION = { hasMore: true, unloadedCount: 8215, totalCount: 8415 };
  const CAPPED_BAND = STRIP_HEIGHT * MINIMAP_BAND_MAX_SHARE;

  function renderStrip(
    props: Partial<React.ComponentProps<typeof SessionMinimap>> = {},
    scroll: Parameters<typeof makeScrollElement>[0] = { scrollTop: 0, clientHeight: 400, scrollHeight: 300 },
  ) {
    const rafQueue = installControllableRAF();
    stubComputedStyle();
    const ctx = installCanvasContextMock() as ReturnType<typeof installCanvasContextMock> & { paints: Paint[] };
    const scrollEl = makeScrollElement(scroll);
    const utils = render(
      <SessionMinimap
        virtualizer={makeVirtualizer()}
        flattenedMessages={SAMPLE_FLATTENED}
        virtualRows={[] as VirtualItem[]}
        totalSize={SAMPLE_TOTAL_SIZE}
        getScrollElement={() => scrollEl as unknown as HTMLElement}
        {...props}
      />,
    );
    return { ...utils, rafQueue, ctx, scrollEl };
  }

  /** jsdom has no PointerEvent; React reads `clientY` off any MouseEvent of the right type. */
  const pointer = (target: Element, type: string, clientY: number) =>
    act(() => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY } as MouseEventInit));
    });

  describe("not-loaded band", () => {
    it("renders no band when every page is loaded", () => {
      const { queryByTestId } = renderStrip({ hasMore: false, unloadedCount: 0, totalCount: 3 });
      expect(queryByTestId("session-minimap-band")).toBeNull();
    });

    it("renders the band at the capped unloaded share of the strip", () => {
      const { getByTestId } = renderStrip(LONG_SESSION);
      expect(getByTestId("session-minimap-band").style.height).toBe(`${CAPPED_BAND}px`);
    });

    it("shows the unloaded count on the band", () => {
      const { getByTestId } = renderStrip(LONG_SESSION);
      expect(getByTestId("session-minimap-band")).toHaveTextContent((8215).toLocaleString());
    });

    it("starts the viewport box at the band's bottom edge at the top of the list", () => {
      const { getByTestId } = renderStrip(LONG_SESSION);
      expect(getByTestId("session-minimap-viewport").style.top).toBe(`${CAPPED_BAND}px`);
    });

    it("paints the session blocks below the band", () => {
      const { rafQueue, ctx } = renderStrip(LONG_SESSION);
      rafQueue.flush();
      const ys = ctx.paints.map((paint) => paint.y);
      expect(ys.length).toBeGreaterThan(0);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(CAPPED_BAND);
      expect(Math.max(...ys)).toBeLessThan(STRIP_HEIGHT);
    });

    it("maps a click below the band onto the region below it", () => {
      const { getByTestId, scrollEl } = renderStrip(LONG_SESSION, {
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 4000,
      });
      const clickY = 120;
      act(() => {
        getByTestId("session-minimap").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, clientY: clickY } as MouseEventInit),
        );
      });
      const mapHeight = STRIP_HEIGHT - CAPPED_BAND;
      const scale = minimapScale(4000, mapHeight);
      expect(scrollEl.scrollTop).toBe(scrollTopForStripY(clickY - CAPPED_BAND, scale, 400, 4000));
    });

    it("loads one older page on a band click, without scrolling the list", () => {
      const onLoadEarlier = vi.fn();
      const { getByTestId, scrollEl } = renderStrip(
        { ...LONG_SESSION, onLoadEarlier },
        { scrollTop: 500, clientHeight: 400, scrollHeight: 4000 },
      );
      act(() => {
        getByTestId("session-minimap-band").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, clientY: 10 } as MouseEventInit),
        );
      });
      expect(onLoadEarlier).toHaveBeenCalledTimes(1);
      expect(scrollEl.scrollTop).toBe(500);
    });

    it("ignores a band click while a page is loading", () => {
      const onLoadEarlier = vi.fn();
      const { getByTestId } = renderStrip({ ...LONG_SESSION, isLoadingMore: true, onLoadEarlier });
      act(() => {
        getByTestId("session-minimap-band").dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, clientY: 10 } as MouseEventInit),
        );
      });
      expect(onLoadEarlier).not.toHaveBeenCalled();
    });

    it("does not start a drag from a press on the band", () => {
      const { getByTestId, scrollEl } = renderStrip(LONG_SESSION, {
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 4000,
      });
      pointer(getByTestId("session-minimap-band"), "pointerdown", 10);
      pointer(getByTestId("session-minimap"), "pointermove", 150);
      expect(scrollEl.scrollTop).toBe(0);
    });
  });

  describe("search ticks", () => {
    const UUID_TO_INDEX = new Map([
      ["p1", 0],
      ["r1", 1],
      ["t1", 2],
    ]);

    it("paints one tick per matched row in the right gutter, the current one taller", () => {
      const { rafQueue, ctx } = renderStrip({
        matchedUuids: new Set(["p1", "t1"]),
        currentMatchUuid: "t1",
        uuidToIndexMap: UUID_TO_INDEX,
      });
      rafQueue.flush();

      const tickX = minimapTickX(STRIP_WIDTH);
      const plain = ctx.paints.filter((paint) => paint.x === tickX && paint.h === MINIMAP_TICK_HEIGHT_PX);
      const current = ctx.paints.filter(
        (paint) => paint.x === tickX && paint.h === MINIMAP_CURRENT_TICK_HEIGHT_PX,
      );
      expect(plain).toHaveLength(1);
      expect(current).toHaveLength(1);
      // The current tick is the last thing painted, over its neighbors.
      expect(ctx.paints[ctx.paints.length - 1]).toBe(current[0]);
    });

    it("never lets a bar paint into the tick's columns", () => {
      const { rafQueue, ctx } = renderStrip({
        matchedUuids: new Set(["p1"]),
        currentMatchUuid: "p1",
        uuidToIndexMap: UUID_TO_INDEX,
      });
      rafQueue.flush();
      const tickX = minimapTickX(STRIP_WIDTH);
      const bars = ctx.paints.filter((paint) => paint.x === MINIMAP_BAR_PAD_PX);
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) expect(bar.x + bar.w).toBeLessThanOrEqual(tickX - 1);
    });

    it("reads tick colors from the search-highlight tokens", () => {
      const { rafQueue, ctx } = renderStrip({
        matchedUuids: new Set(["p1", "t1"]),
        currentMatchUuid: "t1",
        uuidToIndexMap: UUID_TO_INDEX,
      });
      rafQueue.flush();
      const tickX = minimapTickX(STRIP_WIDTH);
      const fills = ctx.paints.filter((paint) => paint.x >= tickX - 1).map((paint) => paint.fill);
      expect(fills).toContain("resolved(--highlight-foreground)");
      expect(fills).toContain("resolved(--highlight-current)");
    });

    it("draws no tick for a match whose row is not loaded", () => {
      const { rafQueue, ctx } = renderStrip({
        matchedUuids: new Set(["unloaded-uuid"]),
        currentMatchUuid: "unloaded-uuid",
        uuidToIndexMap: UUID_TO_INDEX,
      });
      rafQueue.flush();
      expect(ctx.paints.filter((paint) => paint.x >= minimapTickX(STRIP_WIDTH) - 1)).toHaveLength(0);
    });
  });

  describe("hover preview", () => {
    it("shows the hovered row's kind label and a text snippet", () => {
      // 300px of content on a 200px strip: the prompt covers y 0 to 66.
      const { getByTestId } = renderStrip();
      pointer(getByTestId("session-minimap"), "pointermove", 10);
      const tooltip = getByTestId("session-minimap-tooltip");
      expect(tooltip).toHaveTextContent("navigator.kind.prompt");
      expect(tooltip).toHaveTextContent("a typed prompt");
    });

    it("follows the pointer to another row", () => {
      const { getByTestId } = renderStrip();
      pointer(getByTestId("session-minimap"), "pointermove", 10);
      pointer(getByTestId("session-minimap"), "pointermove", 100);
      const tooltip = getByTestId("session-minimap-tooltip");
      expect(tooltip).toHaveTextContent("navigator.kind.reply");
      expect(tooltip).toHaveTextContent("a reply");
    });

    it("shows the not-loaded text, with any unloaded match count, over the band", () => {
      const { getByTestId } = renderStrip({ ...LONG_SESSION, notLoadedMatchCount: 3 });
      pointer(getByTestId("session-minimap"), "pointermove", 10);
      const tooltip = getByTestId("session-minimap-tooltip");
      expect(tooltip).toHaveTextContent("messageViewer.minimap.notLoadedTitle");
      expect(tooltip).toHaveTextContent("messageViewer.minimap.notLoadedBody:8215");
      expect(tooltip).toHaveTextContent("messageViewer.minimap.matchesNotLoaded:3");
    });

    it("shows nothing past the last row", () => {
      // 300px of rows inside 600px of content: the lower half is the list's footer.
      const { getByTestId, queryByTestId } = renderStrip({}, { scrollTop: 0, clientHeight: 400, scrollHeight: 600 });
      pointer(getByTestId("session-minimap"), "pointermove", 180);
      expect(queryByTestId("session-minimap-tooltip")).toBeNull();
    });

    it("hides when the pointer leaves the strip", () => {
      const { getByTestId, queryByTestId } = renderStrip();
      pointer(getByTestId("session-minimap"), "pointermove", 10);
      expect(queryByTestId("session-minimap-tooltip")).not.toBeNull();
      act(() => {
        fireEvent.pointerLeave(getByTestId("session-minimap"));
      });
      expect(queryByTestId("session-minimap-tooltip")).toBeNull();
    });

    it("hides when a drag starts, and stays hidden while dragging", () => {
      const { getByTestId, queryByTestId } = renderStrip();
      const root = getByTestId("session-minimap");
      pointer(root, "pointermove", 10);
      pointer(root, "pointerdown", 10);
      expect(queryByTestId("session-minimap-tooltip")).toBeNull();
      pointer(root, "pointermove", 100);
      expect(queryByTestId("session-minimap-tooltip")).toBeNull();
    });
  });
});
