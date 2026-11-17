// Motion activity probe (plan I0 `motionActivity`, D8): after an interaction,
// is anything moving? Sampled right after the interaction at 0, 16 and 100 ms:
// `document.getAnimations()` (CSS transitions and animations, Web Animations),
// `transitionstart` / `animationstart` events, and how many animation frames a
// scroll keeps firing `scroll` events on, plus per-scroller scrollTop traces.
// Consecutive frames alone cannot distinguish smooth motion from instant
// virtualizer measurement corrections.
//
// Only meaningful in `--live` mode: the deterministic capture suppresses CSS
// motion and freezes the clock, so the probe reports `applicable: false` there
// (see probes.mjs) rather than a vacuous pass.

/* global document, window, requestAnimationFrame -- runs in the page */

const INSTALL = `(() => {
  if (window.__uiMotion) { window.__uiMotion.reset(); return; }
  const state = { transitions: 0, animations: 0, scrollFrames: new Set(), scrollTrace: [], frame: 0 };
  let origins;
  let targets;
  let nextTarget;
  const resetPositions = () => {
    origins = new WeakMap([...document.querySelectorAll("*")].map((el) => [el, el.scrollTop]));
    targets = new WeakMap();
    nextTarget = 0;
    state.scrollTrace = [];
  };
  resetPositions();
  const tick = () => { state.frame += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  document.addEventListener("transitionstart", () => { state.transitions += 1; }, true);
  document.addEventListener("animationstart", () => { state.animations += 1; }, true);
  document.addEventListener("scroll", (event) => {
    state.scrollFrames.add(state.frame);
    const el = event.target === document ? document.scrollingElement : event.target;
    if (!el || typeof el.scrollTop !== "number") return;
    if (!targets.has(el)) {
      targets.set(el, ++nextTarget);
      // Preserve the pre-interaction position so a large instant landing
      // is not mistaken for the first small step of a glide.
      state.scrollTrace.push({ target: nextTarget, frame: state.frame - 1, top: origins.get(el) ?? el.scrollTop });
    }
    state.scrollTrace.push({ target: targets.get(el), frame: state.frame, top: el.scrollTop });
  }, true);
  state.reset = () => { state.transitions = 0; state.animations = 0; state.scrollFrames = new Set(); resetPositions(); };
  window.__uiMotion = state;
})()`;

// Only time-based animations move on their own: a scroll-driven one (its
// timeline is a ScrollTimeline, e.g. OverlayScrollbars' handle) follows the
// scroll position and runs forever, so it is not motion.
const READ = `(() => {
  const s = window.__uiMotion;
  const timeBased = (a) => !a.timeline || a.timeline instanceof DocumentTimeline;
  return {
    animations: document.getAnimations().filter((a) => timeBased(a) && (a.playState === "running" || a.playState === "pending")).length,
    transitionEvents: s.transitions,
    animationEvents: s.animations,
    scrollFrames: s.scrollFrames.size,
    scrollTrace: s.scrollTrace,
    // Legacy activity diagnostic, not a glide verdict: virtualizer offset
    // corrections can also fire on consecutive frames.
    scrollRun: (() => {
      const frames = [...s.scrollFrames].sort((a, b) => a - b);
      let best = 0;
      let run = 0;
      frames.forEach((f, i) => { run = i > 0 && f === frames[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); });
      return best;
    })(),
  };
})()`;

/**
 * Detect a gradual onset of monotone motion, not just consecutive events.
 * Four moving frames are the minimum witness: an instant landing plus up to
 * three measurement corrections must not by itself imply an animation.
 * Only the FIRST step must be at most half the witness's travel, and a later
 * step must be larger: smooth easing has a gradual, accelerating onset, unlike
 * an instant landing or equal/decaying measurement corrections. Later steps
 * may dominate when a busy runner merges paint frames.
 * Inspect suffixes too so a genuine glide following a landing is still caught.
 * This is a shape heuristic, not proof of a browser animation: dropping the
 * onset or leaving fewer than four moving frames can hide a glide. Explicit
 * smooth requests remain independently forbidden by the reduced-motion test.
 */
export function hasScrollGlide(trace) {
  const targets = new Map();
  for (const point of trace) {
    if (!targets.has(point.target)) targets.set(point.target, new Map());
    targets.get(point.target).set(point.frame, point.top);
  }
  for (const frames of targets.values()) {
    const points = [...frames].sort(([a], [b]) => a - b);
    let deltas = [];
    for (let i = 1; i < points.length; i += 1) {
      const delta = points[i][1] - points[i - 1][1];
      if (points[i][0] !== points[i - 1][0] + 1 || delta === 0 || (deltas.length && Math.sign(delta) !== Math.sign(deltas.at(-1)))) deltas = [];
      if (points[i][0] !== points[i - 1][0] + 1 || delta === 0) continue;
      deltas.push(delta);
      for (let start = 0; start <= deltas.length - 4; start += 1) {
        const steps = deltas.slice(start).map(Math.abs);
        if (steps[0] <= steps.reduce((sum, step) => sum + step, 0) / 2 && steps.some((step) => step > steps[0])) return true;
      }
    }
  }
  return false;
}

export const MOTION_SAMPLE_MS = [0, 16, 100];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `interact()` and sample motion. `realClock` (default true, i.e. --live)
 * waits real time between samples; with a paused page clock the samples are
 * taken back to back (timers do not run, which is the point of the test).
 */
export async function measureMotion(page, interact, { realClock = true } = {}) {
  await page.evaluate(INSTALL);
  await interact();
  const animationsAt = [];
  let last = null;
  let elapsed = 0;
  for (const at of MOTION_SAMPLE_MS) {
    if (realClock && at > elapsed) await sleep(at - elapsed);
    elapsed = at;
    last = await page.evaluate(READ);
    animationsAt.push(last.animations);
  }
  if (realClock) await sleep(250); // let a smooth scroll finish its frames
  const end = await page.evaluate(READ);
  const result = {
    sampledAtMs: MOTION_SAMPLE_MS,
    animationsAt,
    transitionEvents: end.transitionEvents,
    animationEvents: end.animationEvents,
    scrollFrames: end.scrollFrames,
    scrollRun: end.scrollRun,
    scrollTrace: end.scrollTrace,
    scrollGlide: hasScrollGlide(end.scrollTrace),
  };
  result.observed = animationsAt.some((n) => n > 0) || result.transitionEvents > 0 || result.animationEvents > 0 || result.scrollFrames > 1;
  return result;
}
