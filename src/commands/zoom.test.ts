/**
 * Page zoom (plan §9b A1): View → Zoom In / Zoom Out / Actual Size, their
 * keys and Ctrl + wheel. One level, set synchronously before the web view is
 * asked (review-2 F3), one step per wheel notch on every engine (review-2
 * live check), and WebView2 as the zoom input owner on Windows (review-2 F4).
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  createCtrlWheelZoom,
  createZoomController,
  engineOwnsZoomInput,
  nextZoom,
  type ZoomStep,
} from "./zoom";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("nextZoom", () => {
  it("steps by 20%, resets to 100%, and stays within 20%-1000% (the engine's old steps)", () => {
    expect(nextZoom(1, "in")).toBe(1.2);
    expect(nextZoom(1, "out")).toBe(0.8);
    expect(nextZoom(1.6, "reset")).toBe(1);
    expect(nextZoom(MAX_ZOOM, "in")).toBe(MAX_ZOOM);
    expect(nextZoom(MIN_ZOOM, "out")).toBe(MIN_ZOOM);
  });

  it("does not drift: five steps in and five out come back to exactly 100%", () => {
    let level = 1;
    for (let i = 0; i < 5; i++) level = nextZoom(level, "in");
    expect(level).toBe(2);
    for (let i = 0; i < 5; i++) level = nextZoom(level, "out");
    expect(level).toBe(1);
  });
});

/** A web view whose `setZoom` answers only when told to. */
function slowWebView() {
  const requested: number[] = [];
  const replies: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const setZoom = (level: number) =>
    new Promise<void>((resolve, reject) => {
      requested.push(level);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      replies.push({
        resolve: () => {
          inFlight -= 1;
          resolve();
        },
        reject: (error) => {
          inFlight -= 1;
          reject(error);
        },
      });
    });
  return {
    setZoom,
    requested,
    maxInFlight: () => maxInFlight,
    answer: () => replies.shift()?.resolve(),
    fail: (error: unknown) => replies.shift()?.reject(error),
  };
}

describe("zoom controller", () => {
  it("applies each step to the web view", async () => {
    const setZoom = vi.fn(async () => {});
    const zoom = createZoomController(setZoom);
    await zoom.apply("in");
    await zoom.apply("in");
    await zoom.apply("reset");
    expect(setZoom.mock.calls.map(([level]) => level)).toEqual([1.2, 1.4, 1]);
    expect(zoom.level()).toBe(1);
  });

  it("counts every step of a burst: three quick steps in reach 160% (review-2 Z1)", async () => {
    const setZoom = vi.fn(async () => {});
    const zoom = createZoomController(setZoom);
    const jobs = [zoom.apply("in"), zoom.apply("in"), zoom.apply("in")];
    expect(zoom.level()).toBe(1.6); // the level moves at once, before the web view answers
    await Promise.all(jobs);
    expect(zoom.level()).toBe(1.6);
    expect(setZoom).toHaveBeenLastCalledWith(1.6);
  });

  it("lets opposite quick steps cancel out: In then Out ends at 100% (review-2 Z2)", async () => {
    const setZoom = vi.fn(async () => {});
    const zoom = createZoomController(setZoom);
    await Promise.all([zoom.apply("in"), zoom.apply("out")]);
    expect(zoom.level()).toBe(1);
    const last = setZoom.mock.calls.at(-1)?.[0];
    expect(last === undefined || last === 1).toBe(true);
  });

  it("asks the web view one level at a time, the newest level last, even when it answers slowly", async () => {
    const view = slowWebView();
    const zoom = createZoomController(view.setZoom);
    const jobs = [zoom.apply("in")];
    await flush();
    jobs.push(zoom.apply("in"), zoom.apply("in"));
    view.answer();
    await flush();
    view.answer();
    await Promise.all(jobs);
    expect(view.maxInFlight()).toBe(1);
    expect(view.requested.at(-1)).toBe(1.6);
    expect(zoom.level()).toBe(1.6);
  });

  it("falls back to the level the web view last applied when it refuses, reports it once, and keeps working", async () => {
    const view = slowWebView();
    const zoom = createZoomController(view.setZoom);
    const first = zoom.apply("in");
    await flush();
    const second = zoom.apply("in");
    view.fail(new Error("denied"));
    const results = await Promise.allSettled([first, second]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    expect(zoom.level()).toBe(1);
    const third = zoom.apply("in");
    await flush();
    view.answer();
    await third;
    expect(zoom.level()).toBe(1.2);
    expect(view.requested.at(-1)).toBe(1.2);
  });
});

describe("zoom input owner per platform", () => {
  it("is WebView2 on Windows; the zoom commands on macOS, Linux; the browser in the WebUI", () => {
    expect(engineOwnsZoomInput({ os: "win", runtime: "desktop" })).toBe(true);
    expect(engineOwnsZoomInput({ os: "mac", runtime: "desktop" })).toBe(false);
    expect(engineOwnsZoomInput({ os: "linux", runtime: "desktop" })).toBe(false);
    expect(engineOwnsZoomInput({ os: "win", runtime: "web" })).toBe(false);
  });
});

describe("Ctrl + wheel", () => {
  /** A wheel event; `wheelDeltaY` is the legacy ±120-per-notch value WebKit and Chromium both report. */
  const wheel = (init: WheelEventInit & { wheelDeltaY?: number }) => {
    const { wheelDeltaY, ...rest } = init;
    const event = new WheelEvent("wheel", { cancelable: true, ...rest });
    if (wheelDeltaY !== undefined) Object.defineProperty(event, "wheelDeltaY", { value: wheelDeltaY });
    return event;
  };
  const record = () => {
    const steps: ZoomStep[] = [];
    return { steps, handle: createCtrlWheelZoom((step) => steps.push(step)) };
  };

  it("zooms one step per mouse-wheel notch in WebKit (40 px a notch), in when scrolling up, and takes the event", () => {
    const { steps, handle } = record();
    const up = wheel({ ctrlKey: true, deltaY: -40, wheelDeltaY: 120 });
    handle(up);
    handle(wheel({ ctrlKey: true, deltaY: 40, wheelDeltaY: -120 }));
    expect(steps).toEqual(["in", "out"]);
    expect(up.defaultPrevented).toBe(true);
  });

  it("zooms one step per notch in Chromium (100 px a notch)", () => {
    const { steps, handle } = record();
    handle(wheel({ ctrlKey: true, deltaY: -100, wheelDeltaY: 120 }));
    expect(steps).toEqual(["in"]);
  });

  it("zooms three steps for one event that carries three notches", () => {
    const { steps, handle } = record();
    handle(wheel({ ctrlKey: true, deltaY: -300, wheelDeltaY: 360 }));
    expect(steps).toEqual(["in", "in", "in"]);
  });

  it("adds up a trackpad's small deltas to a notch instead of stepping on each", () => {
    const { steps, handle } = record();
    for (let i = 0; i < 9; i++) handle(wheel({ ctrlKey: true, deltaY: -4, wheelDeltaY: 12 }));
    expect(steps).toEqual([]);
    handle(wheel({ ctrlKey: true, deltaY: -4, wheelDeltaY: 12 }));
    expect(steps).toEqual(["in"]);
  });

  it("starts over when the direction turns", () => {
    const { steps, handle } = record();
    for (let i = 0; i < 9; i++) handle(wheel({ ctrlKey: true, deltaY: -4, wheelDeltaY: 12 }));
    handle(wheel({ ctrlKey: true, deltaY: 4, wheelDeltaY: -12 }));
    handle(wheel({ ctrlKey: true, deltaY: -4, wheelDeltaY: 12 }));
    expect(steps).toEqual([]);
  });

  it("without wheelDeltaY, counts 3 lines or 100 px as a notch", () => {
    const { steps, handle } = record();
    handle(wheel({ ctrlKey: true, deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE }));
    handle(wheel({ ctrlKey: true, deltaY: 100 }));
    expect(steps).toEqual(["in", "out"]);
  });

  it("leaves a plain scroll alone", () => {
    const { steps, handle } = record();
    const scroll = wheel({ deltaY: -40, wheelDeltaY: 120 });
    handle(scroll);
    expect(steps).toEqual([]);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("reaches 160% from one three-notch event through the controller (review-2 Z1)", async () => {
    const setZoom = vi.fn(async () => {});
    const zoom = createZoomController(setZoom);
    const jobs: Promise<void>[] = [];
    createCtrlWheelZoom((step) => jobs.push(zoom.apply(step)))(
      wheel({ ctrlKey: true, deltaY: -300, wheelDeltaY: 360 }),
    );
    await Promise.all(jobs);
    expect(zoom.level()).toBe(1.6);
    expect(setZoom).toHaveBeenLastCalledWith(1.6);
  });
});
