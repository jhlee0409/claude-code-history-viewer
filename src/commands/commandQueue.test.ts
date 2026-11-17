/**
 * The one command executor (docs/adr/0001-native-menu-input-ownership.md,
 * review-3 F1): keys, the palette, toolbar controls and menu events run in
 * the order they arrived. A hold (the menu journal asking the host for older
 * events) keeps later commands waiting behind it, never longer than its limit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_LIMIT_MS, createCommandQueue } from "./commandQueue";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("command queue", () => {
  it("runs a command at once, in the caller's task, when nothing holds it", () => {
    const queue = createCommandQueue();
    const ran: string[] = [];
    queue.submit(() => ran.push("key"));
    expect(ran).toEqual(["key"]);
  });

  it("keeps commands that arrive during a hold behind it; the holder's own run at its place", () => {
    const queue = createCommandQueue();
    const ran: string[] = [];
    const hold = queue.hold();
    queue.submit(() => ran.push("key: close tab"));
    queue.submit(() => ran.push("palette: back"));
    expect(ran).toEqual([]);
    hold.run(() => ran.push("menu: new tab"));
    expect(ran).toEqual(["menu: new tab"]);
    hold.release();
    expect(ran).toEqual(["menu: new tab", "key: close tab", "palette: back"]);
  });

  it("runs commands at once again after the hold is released", () => {
    const queue = createCommandQueue();
    const ran: string[] = [];
    queue.hold().release();
    queue.submit(() => ran.push("key"));
    expect(ran).toEqual(["key"]);
  });

  it("lets the waiting commands run once a hold outlives its limit; the holder's late ones follow", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = createCommandQueue();
    const ran: string[] = [];
    const hold = queue.hold();
    queue.submit(() => ran.push("key"));
    vi.advanceTimersByTime(HOLD_LIMIT_MS - 1);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(["key"]);
    hold.run(() => ran.push("menu"));
    hold.release();
    queue.submit(() => ran.push("key 2"));
    expect(ran).toEqual(["key", "menu", "key 2"]);
  });

  it("runs a command submitted by a running command after it, not inside it", () => {
    const queue = createCommandQueue();
    const ran: string[] = [];
    queue.submit(() => {
      ran.push("outer:start");
      queue.submit(() => ran.push("inner"));
      ran.push("outer:end");
    });
    expect(ran).toEqual(["outer:start", "outer:end", "inner"]);
  });

  it("goes on after a command that throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = createCommandQueue();
    const ran: string[] = [];
    const hold = queue.hold();
    queue.submit(() => {
      throw new Error("boom");
    });
    queue.submit(() => ran.push("next"));
    hold.release();
    expect(ran).toEqual(["next"]);
  });
});
