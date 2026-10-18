// Motion activity probe (plan I0 `motionActivity`, D8): after an interaction,
// is anything moving? Sampled right after the interaction at 0, 16 and 100 ms:
// `document.getAnimations()` (CSS transitions and animations, Web Animations),
// `transitionstart` / `animationstart` events, and how many animation frames a
// scroll keeps firing `scroll` events on (a smooth scroll spreads over many
// frames; an instant one fires in one).
//
// Only meaningful in `--live` mode: the deterministic capture suppresses CSS
// motion and freezes the clock, so the probe reports `applicable: false` there
// (see probes.mjs) rather than a vacuous pass.

/* global document, window, requestAnimationFrame -- runs in the page */

const INSTALL = `(() => {
  if (window.__uiMotion) { window.__uiMotion.reset(); return; }
  const state = { transitions: 0, animations: 0, scrollFrames: new Set(), frame: 0 };
  const tick = () => { state.frame += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  document.addEventListener("transitionstart", () => { state.transitions += 1; }, true);
  document.addEventListener("animationstart", () => { state.animations += 1; }, true);
  document.addEventListener("scroll", () => { state.scrollFrames.add(state.frame); }, true);
  state.reset = () => { state.transitions = 0; state.animations = 0; state.scrollFrames = new Set(); };
  window.__uiMotion = state;
})()`;

const READ = `(() => {
  const s = window.__uiMotion;
  return {
    animations: document.getAnimations().filter((a) => a.playState === "running" || a.playState === "pending").length,
    transitionEvents: s.transitions,
    animationEvents: s.animations,
    scrollFrames: s.scrollFrames.size,
  };
})()`;

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
  };
  result.observed = animationsAt.some((n) => n > 0) || result.transitionEvents > 0 || result.animationEvents > 0 || result.scrollFrames > 1;
  return result;
}
