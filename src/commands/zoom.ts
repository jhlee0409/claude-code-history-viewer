/**
 * Page zoom (plan §9b A1): View → Zoom In / Zoom Out / Actual Size, their
 * keys (⌘= and ⌘+, ⌘-, ⌘0; Ctrl elsewhere) and Ctrl + wheel.
 *
 * These commands are the desktop web view's one zoom owner. The engine's own
 * zoom hotkeys (`zoomHotkeysEnabled` in `tauri.conf.json` - a keydown
 * polyfill on macOS/Linux, WebView2's zoom control on Windows) stay off, or
 * a key would zoom twice. The steps are the engine's old ones: 20% per step,
 * from 20% to 1000%, back to 100% for Actual Size. The level is not saved; a
 * new window starts at 100%, as before.
 */
export type ZoomStep = "in" | "out" | "reset";

export const ZOOM_STEP = 0.2;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 10;

/** The level after `step` from `level`, kept to one decimal so steps do not drift. */
export function nextZoom(level: number, step: ZoomStep): number {
  if (step === "reset") return 1;
  const next = level + (step === "in" ? ZOOM_STEP : -ZOOM_STEP);
  return Math.round(Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM) * 10) / 10;
}

export interface ZoomController {
  /** Zoom by `step`; rejects (keeping the old level) if the web view refuses. */
  apply: (step: ZoomStep) => Promise<void>;
  level: () => number;
}

export function createZoomController(setZoom: (level: number) => Promise<void>): ZoomController {
  let level = 1;
  return {
    apply: async (step) => {
      const next = nextZoom(level, step);
      await setZoom(next);
      level = next;
    },
    level: () => level,
  };
}

/** The desktop web view's zoom (needs `core:webview:allow-set-webview-zoom`). */
export const appZoom: ZoomController = createZoomController(async (level) => {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().setZoom(level);
});

/** Wheel distance of one zoom step: one mouse-wheel notch. */
const WHEEL_NOTCH_PX = 100;
const LINE_PX = 16;

/**
 * Ctrl + wheel zooms (what the engine's zoom did): one step per wheel notch,
 * in when scrolling up. A trackpad's small deltas add up to a notch first.
 */
export function createCtrlWheelZoom(zoom: (step: Exclude<ZoomStep, "reset">) => void): (event: WheelEvent) => void {
  let distance = 0;
  return (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_PX : event.deltaY;
    if (delta === 0) return;
    if (Math.sign(delta) !== Math.sign(distance)) distance = 0;
    distance += delta;
    while (Math.abs(distance) >= WHEEL_NOTCH_PX) {
      zoom(distance < 0 ? "in" : "out");
      distance -= Math.sign(distance) * WHEEL_NOTCH_PX;
    }
  };
}
