/**
 * Page zoom (plan §9b A1): View → Zoom In / Zoom Out / Actual Size, their
 * keys (⌘= and ⌘+, ⌘-, ⌘0; Ctrl elsewhere) and Ctrl + wheel.
 *
 * Zoom input has one owner per platform (`engineOwnsZoomInput`):
 * - macOS, Linux: these commands. The engine's zoom hotkeys
 *   (`zoomHotkeysEnabled`, a keydown/wheel polyfill there) stay off in
 *   `tauri.conf.json`, or a key would zoom twice.
 * - Windows: WebView2 itself - its zoom keys, Ctrl + wheel and pinch zoom are
 *   one switch (`zoomHotkeysEnabled: true` in `tauri.windows.conf.json`), so
 *   the page binds no zoom key and no wheel there. The menu items set the
 *   same engine zoom; they step from the level they last set, as the engine's
 *   own level cannot be read.
 *
 * The controller's level is the one source of truth on the page: each step
 * moves it at once, before the web view is asked, so a burst of steps (three
 * wheel notches, quick presses) counts every step and opposite steps cancel
 * out. The web view is asked one level at a time, always the newest; if it
 * refuses, the level falls back to the last one it applied.
 *
 * Steps are the engine's old ones: 20% per step, from 20% to 1000%, back to
 * 100% for Actual Size. The level is not saved; a new window starts at 100%.
 */
import type { KeyEnvironment } from "./keys";

export type ZoomStep = "in" | "out" | "reset";

export const ZOOM_STEP = 0.2;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;

/** Where the web view owns zoom input (keys, wheel, pinch): WebView2 on Windows. */
export const engineOwnsZoomInput = (env: KeyEnvironment): boolean => env.runtime === "desktop" && env.os === "win";

/** The level after `step` from `level`, kept to one decimal so steps do not drift. */
export function nextZoom(level: number, step: ZoomStep): number {
  if (step === "reset") return 1;
  const next = level + (step === "in" ? ZOOM_STEP : -ZOOM_STEP);
  return Math.round(Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM) * 10) / 10;
}

export interface ZoomController {
  /**
   * Zoom by `step`. The level moves now; the promise settles once the web
   * view has the level (or a newer one), and rejects if it refused.
   */
  apply: (step: ZoomStep) => Promise<void>;
  /** The level asked for last (what the page shows once the web view catches up). */
  level: () => number;
}

export function createZoomController(setZoom: (level: number) => Promise<void>): ZoomController {
  /** The level asked for, moved synchronously by each step. */
  let target = 1;
  /** The level the web view last applied. */
  let applied = 1;
  /** The web view is asked one level at a time, in step order. */
  let tail: Promise<void> = Promise.resolve();
  return {
    apply: (step) => {
      target = nextZoom(target, step);
      const job = tail.then(async () => {
        const wanted = target; // the newest level; an older one is never sent
        if (wanted === applied) return;
        try {
          await setZoom(wanted);
          applied = wanted;
        } catch (error) {
          target = applied;
          throw error;
        }
      });
      tail = job.catch(() => undefined);
      return job;
    },
    level: () => target,
  };
}

/** The desktop web view's zoom (needs `core:webview:allow-set-webview-zoom`). */
export const appZoom: ZoomController = createZoomController(async (level) => {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().setZoom(level);
});

/** `wheelDeltaY` of one mouse-wheel notch, in WebKit and Chromium alike. */
const NOTCH = 120;
/** Without `wheelDeltaY`: a notch is 3 lines, or 100 px (Chromium, WebView2). */
const NOTCH_LINES = 3;
const NOTCH_PX = 100;

/** The event's scroll in `wheelDeltaY` units (120 a notch), positive when scrolling down. */
function wheelUnits(event: WheelEvent): number {
  const legacy = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof legacy === "number" && legacy !== 0) return -legacy;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return (event.deltaY / NOTCH_LINES) * NOTCH;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * NOTCH;
  return (event.deltaY / NOTCH_PX) * NOTCH;
}

/**
 * Ctrl + wheel zooms (what the engine's zoom did): one step per wheel notch,
 * in when scrolling up. Notches are counted with `wheelDeltaY` (±120 a notch
 * in WebKit, where a notch scrolls 40 px, and in Chromium, where it scrolls
 * 100 px); a trackpad's small deltas add up to a notch first.
 */
export function createCtrlWheelZoom(zoom: (step: Exclude<ZoomStep, "reset">) => void): (event: WheelEvent) => void {
  let distance = 0;
  return (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const units = wheelUnits(event);
    if (units === 0) return;
    if (Math.sign(units) !== Math.sign(distance)) distance = 0;
    distance += units;
    while (Math.abs(distance) >= NOTCH - 1e-6) {
      zoom(distance < 0 ? "in" : "out");
      distance -= Math.sign(distance) * NOTCH;
    }
  };
}
