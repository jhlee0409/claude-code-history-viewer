// Numeric probes, measured after the screenshot (they scroll).
//
//   mainWidth      [data-slot=main] getBoundingClientRect().width (CSS px)
//   projectRows    [data-row=project] fully inside the sidebar scroll area
//                  (the intersection of the window and every clipping
//                  ancestor); session rows, library rows and "show all" carry
//                  no data-row=project and are never counted
//   measurementState  sidebar width, root font size, inspector (navigator)
//                  storage flag, sessions layout - the C4 measurement state
//                  each scenario is meant to start from (see checkMeasurementState)
//   minFontSize    smallest computed font-size of any rendered, visible text,
//                  sampled at evenly spaced scroll positions of every
//                  scrollable container (virtualized lists render as they go)
//                  and, at every position, again after opening the collapsed
//                  content in view (see EXPAND_COLLAPSED)

/* global window -- functions passed to page.evaluate run in the page */

import { parkPointer } from "./browser.mjs";

/** Shared in-page helpers, injected as source into each evaluate call. */
const PAGE_HELPERS = `
  const intersect = (a, b) => ({
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.min(a.right, b.right),
  });
  const clipRectOf = (element) => {
    let rect = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clips = /(auto|scroll|hidden|clip)/.test(style.overflowX + " " + style.overflowY) || style.clip !== "auto";
      if (clips) rect = intersect(rect, node.getBoundingClientRect());
    }
    return rect;
  };
`;

const LAYOUT_PROBE = `(() => {
  ${PAGE_HELPERS}
  const round = (n) => Math.round(n * 100) / 100;
  const main = document.querySelector('[data-slot="main"]');
  const rows = [...document.querySelectorAll('[data-row="project"]')];
  const fully = rows.filter((row) => {
    const box = row.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    if (!row.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const clip = clipRectOf(row);
    return box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5 && box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5;
  });
  const expanded = fully.filter((row) => row.getAttribute("aria-expanded") === "true");
  const scrollArea = rows.length ? clipRectOf(rows[0]) : null;
  const sidebar = document.getElementById("project-explorer");
  const sidebarBox = sidebar && sidebar.checkVisibility() ? sidebar.getBoundingClientRect() : null;
  return {
    measurementState: {
      sidebarWidth: sidebarBox ? round(sidebarBox.width) : null,
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      // The app's font-size setting: a CSS variable on <html>, not the root size.
      appFontScale: (() => {
        const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-font-scale"));
        return Number.isFinite(value) ? value : null;
      })(),
      // The inspector's record (T9a), else the message navigator's flag
      // (builds before T9a); reported as "true" / "false".
      inspectorOpenStored: (() => {
        try {
          const record = localStorage.getItem("inspector.v1");
          if (record !== null) {
            const open = JSON.parse(record)?.open;
            return typeof open === "boolean" ? String(open) : null;
          }
          return localStorage.getItem("navigator-open");
        } catch {
          return null; // opaque origin (no storage), or an unreadable record
        }
      })(),
      sessionsLayout: document.getElementById("sessions-pane") ? "pane" : "inline",
      // Conversation tabs (T8): the strip's tabs (md and up), else the
      // phone toolbar's tab count; null on builds without tabs.
      tabs: (() => {
        const strip = document.querySelector('[data-slot="tabs"]');
        if (strip && strip.checkVisibility()) return strip.querySelectorAll('[role="tab"]').length;
        const count = document.querySelector("[data-mobile-tabs]");
        return count && count.checkVisibility() ? Number(count.textContent.trim()) : null;
      })(),
      selectedProjects: rows.filter((row) => row.getAttribute("aria-selected") === "true").length,
      expandedProjects: rows.filter((row) => row.getAttribute("aria-expanded") === "true").length,
    },
    hasReadyMarker: document.querySelector("[data-ready]") !== null,
    mainWidth: main ? round(main.getBoundingClientRect().width) : null,
    projectRows: {
      total: rows.length,
      fullyVisible: fully.length,
      fullyVisibleExcludingExpanded: fully.length - expanded.length,
      expanded: expanded.length,
    },
    sidebarScrollArea: scrollArea
      ? { top: round(scrollArea.top), height: round(Math.max(0, scrollArea.bottom - scrollArea.top)) }
      : null,
  };
})()`;

const FONT_SAMPLE = `(() => {
  ${PAGE_HELPERS}
  let min = Infinity;
  let minAt = null;
  let samples = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (!text) continue;
    const element = node.parentElement;
    if (!element || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const clip = clipRectOf(element);
    // Visible part of the text: inside the window and every clipping
    // ancestor (this also drops sr-only text clipped to a 1px box).
    const visible = [...range.getClientRects()].some((r) => {
      const v = intersect(r, clip);
      return v.right - v.left >= 2 && v.bottom - v.top >= 2;
    });
    if (!visible) continue;
    samples += 1;
    const size = parseFloat(getComputedStyle(element).fontSize);
    if (size < min) {
      min = size;
      minAt = {
        text: text.slice(0, 60),
        tag: element.tagName.toLowerCase(),
        className: String(element.getAttribute("class") || "").slice(0, 120),
      };
    }
  }
  return { min: Number.isFinite(min) ? min : null, minAt, samples };
})()`;

/**
 * Open the collapsed content currently in view inside the main pane:
 * disclosure controls (aria-expanded="false", not menus/popups, not tree
 * rows) are clicked once and closed <details> are opened. Each control is
 * marked so a later pass never toggles it back. Runs after the screenshot,
 * so it never affects pixels. Returns how many were opened.
 */
const EXPAND_COLLAPSED = `(() => {
  ${PAGE_HELPERS}
  const scope = document.querySelector('[data-slot="main"]') || document.getElementById("main-content") || document.body;
  const inView = (element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const v = intersect(box, clipRectOf(element));
    return v.right - v.left >= 1 && v.bottom - v.top >= 1;
  };
  let opened = 0;
  for (const details of scope.querySelectorAll("details:not([open])")) {
    if (details.hasAttribute("data-ui-capture-opened") || !inView(details)) continue;
    details.setAttribute("data-ui-capture-opened", "");
    details.open = true;
    opened += 1;
  }
  const controls = scope.querySelectorAll('[aria-expanded="false"]:not([aria-haspopup]):not([data-tree-node]):not([role="combobox"])');
  for (const control of controls) {
    if (control.hasAttribute("data-ui-capture-opened") || control.closest("[data-ui-capture-opened]") === control || !inView(control)) continue;
    if (control.matches(":disabled, [aria-disabled=true]")) continue;
    control.setAttribute("data-ui-capture-opened", "");
    control.click();
    opened += 1;
  }
  return opened;
})()`;

const SCROLLABLES = `(() => {
  const found = [];
  for (const element of document.querySelectorAll("*")) {
    if (element.scrollHeight - element.clientHeight < 8 || element.clientHeight < 40) continue;
    const style = getComputedStyle(element);
    if (!/(auto|scroll)/.test(style.overflowY)) continue;
    if (!element.checkVisibility()) continue;
    found.push(element);
  }
  found.sort((a, b) => b.scrollHeight - a.scrollHeight);
  window.__uiCaptureScrollables = found.slice(0, 4);
  return window.__uiCaptureScrollables.map((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
})()`;

/**
 * Differences between the measured state and the expected C4 measurement
 * state. Desktop only: on mobile the sidebar is a full-width drawer. A
 * collapsed-to-rail sidebar or a screen without the tree reports null width
 * and is not judged.
 */
export function checkMeasurementState(measured, expected, { mobile }) {
  const problems = [];
  if (!measured) return ["no measurement state recorded"];
  if (!mobile && measured.sidebarWidth !== null && measured.sidebarWidth !== expected.sidebarWidthPx) {
    problems.push(`sidebar ${measured.sidebarWidth}px, expected ${expected.sidebarWidthPx}px`);
  }
  if (measured.inspectorOpenStored !== String(expected.inspectorOpen)) {
    problems.push(`inspector (stored open) ${measured.inspectorOpenStored}, expected ${expected.inspectorOpen}`);
  }
  // The font-size setting scales the type tokens through --app-font-scale;
  // the root font size stays the browser default at every scale.
  // 16px unless the --font-scale variant sets the browser text size.
  const rootFontSizePx = expected.rootFontSizePx ?? 16;
  if (measured.rootFontSize !== rootFontSizePx) {
    problems.push(`root font size ${measured.rootFontSize}px, expected ${rootFontSizePx}px`);
  }
  if (measured.tabs !== undefined && measured.tabs !== null && expected.tabs !== undefined && measured.tabs !== expected.tabs) {
    problems.push(`${measured.tabs} tabs open, expected ${expected.tabs}`);
  }
  const expectedScale = expected.fontScalePercent / 100;
  if (measured.appFontScale !== undefined && measured.appFontScale !== null && Math.abs(measured.appFontScale - expectedScale) > 1e-6) {
    problems.push(`--app-font-scale ${measured.appFontScale}, expected ${expectedScale} (scale ${expected.fontScalePercent}%)`);
  }
  return problems;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sampleFonts(page, accumulator) {
  const sample = await page.evaluate(FONT_SAMPLE);
  accumulator.samples += sample.samples;
  accumulator.positions += 1;
  if (sample.min !== null && (accumulator.min === null || sample.min < accumulator.min)) {
    accumulator.min = sample.min;
    accumulator.minAt = sample.minAt;
  }
}

/** Let React, rAF and timer work catch up (page timers run on the paused clock). */
async function letPageWork(page, live) {
  await sleep(30);
  // Live mode (--live) runs on the real clock: nothing to advance.
  if (live) await sleep(50);
  else await page.clock.runFor(50);
  await sleep(30);
}

/** Sample, then open what is collapsed in view and sample the opened content. */
async function sampleWithExpanded(page, fonts, expandCollapsed, live) {
  await sampleFonts(page, fonts);
  if (!expandCollapsed) return;
  const opened = await page.evaluate(EXPAND_COLLAPSED);
  if (opened === 0) return;
  fonts.expandedControls += opened;
  fonts.expandedPositions += 1;
  await letPageWork(page, live);
  await sampleFonts(page, fonts);
}

export async function runProbes(page, { maxPositionsPerContainer = 16, expandCollapsed = true, live = false } = {}) {
  const layout = await page.evaluate(LAYOUT_PROBE);
  const fonts = { min: null, minAt: null, samples: 0, positions: 0, expandedControls: 0, expandedPositions: 0 };
  await sampleWithExpanded(page, fonts, expandCollapsed, live);

  const containers = await page.evaluate(SCROLLABLES);
  for (let index = 0; index < containers.length; index += 1) {
    const { scrollHeight, clientHeight } = containers[index];
    const maxScroll = scrollHeight - clientHeight;
    const count = Math.min(maxPositionsPerContainer, Math.ceil(maxScroll / clientHeight) + 1);
    for (let step = 1; step <= count; step += 1) {
      const top = Math.round((maxScroll * step) / count);
      await page.evaluate(([i, y]) => {
        const element = window.__uiCaptureScrollables[i];
        if (element) element.scrollTop = y;
      }, [index, top]);
      // Let the virtualizer react: scroll events and React work run in real
      // time, rAF/timer work needs the paused clock to move.
      await letPageWork(page);
      await sampleWithExpanded(page, fonts, expandCollapsed, live);
    }
    await page.evaluate((i) => {
      const element = window.__uiCaptureScrollables[i];
      if (element) element.scrollTop = 0;
    }, index);
  }
  await parkPointer(page);

  return {
    ...layout,
    minFontSize: {
      px: fonts.min,
      at: fonts.minAt,
      textNodesSampled: fonts.samples,
      scrollPositionsSampled: fonts.positions,
      scrollContainers: containers.length,
      // Collapsed content opened in the main pane and sampled (C4/T0:
      // "펼친 내용도 포함한다").
      expandedControls: fonts.expandedControls,
      expandedPositions: fonts.expandedPositions,
    },
  };
}
