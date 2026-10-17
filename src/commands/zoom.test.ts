/**
 * Page zoom (plan §9b A1): View → Zoom In / Zoom Out / Actual Size and their
 * keys are the web view's one zoom owner; the engine's own zoom hotkeys are off.
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, createCtrlWheelZoom, createZoomController, nextZoom } from "./zoom";

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

  it("keeps the old level when the web view refuses, and reports the failure", async () => {
    const zoom = createZoomController(vi.fn(async () => Promise.reject(new Error("denied"))));
    await expect(zoom.apply("in")).rejects.toThrow("denied");
    expect(zoom.level()).toBe(1);
  });
});

describe("Ctrl + wheel", () => {
  const wheel = (init: WheelEventInit) => new WheelEvent("wheel", { cancelable: true, ...init });

  it("zooms one step per wheel notch, in when scrolling up, and takes the event", () => {
    const steps: string[] = [];
    const handle = createCtrlWheelZoom((step) => steps.push(step));
    const up = wheel({ ctrlKey: true, deltaY: -100 });
    handle(up);
    handle(wheel({ ctrlKey: true, deltaY: 100 }));
    expect(steps).toEqual(["in", "out"]);
    expect(up.defaultPrevented).toBe(true);
  });

  it("adds up a trackpad's small deltas instead of stepping on each", () => {
    const steps: string[] = [];
    const handle = createCtrlWheelZoom((step) => steps.push(step));
    for (let i = 0; i < 9; i++) handle(wheel({ ctrlKey: true, deltaY: -10 }));
    expect(steps).toEqual([]);
    handle(wheel({ ctrlKey: true, deltaY: -10 }));
    expect(steps).toEqual(["in"]);
  });

  it("leaves a plain scroll alone", () => {
    const steps: string[] = [];
    const handle = createCtrlWheelZoom((step) => steps.push(step));
    const scroll = wheel({ deltaY: -100 });
    handle(scroll);
    expect(steps).toEqual([]);
    expect(scroll.defaultPrevented).toBe(false);
  });
});
