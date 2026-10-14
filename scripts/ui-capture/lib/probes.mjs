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
      inspectorOpenStored: localStorage.getItem("navigator-open"),
      sessionsLayout: document.getElementById("sessions-pane") ? "pane" : "inline",
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
    problems.push(`inspector (navigator-open) ${measured.inspectorOpenStored}, expected ${expected.inspectorOpen}`);
  }
  const expectedRootPx = (16 * expected.fontScalePercent) / 100;
  if (measured.rootFontSize !== expectedRootPx) {
    problems.push(`root font size ${measured.rootFontSize}px, expected ${expectedRootPx}px (scale ${expected.fontScalePercent}%)`);
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

export async function runProbes(page, { maxPositionsPerContainer = 16 } = {}) {
  const layout = await page.evaluate(LAYOUT_PROBE);
  const fonts = { min: null, minAt: null, samples: 0, positions: 0 };
  await sampleFonts(page, fonts);

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
      await sleep(30);
      await page.clock.runFor(50);
      await sleep(30);
      await sampleFonts(page, fonts);
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
    },
  };
}
