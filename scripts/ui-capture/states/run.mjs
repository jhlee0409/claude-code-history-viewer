#!/usr/bin/env node
// Primitive states gallery (plan I0 → `pnpm ui:states`).
//
//   pnpm ui:states                       build the gallery, measure every run
//   pnpm ui:states --no-build            reuse .ui-capture/states/dist
//   pnpm ui:states --runs webkit-dark    only some runs (comma list)
//
// Renders the real src/components/ui primitives (states/gallery.tsx) and, per
// run (WebKit light, WebKit dark, Chromium forced colours light/dark), for
// every `[data-ctl]` instance: crops at rest, on hover, on keyboard focus
// (reached with the keyboard, so :focus-visible matches) and pressed, plus the
// static states (disabled, aria-disabled, loading, error, selected, checked)
// against their control's `default`. Visibility = statesJudge.focusChange.
// Writes .ui-capture/states/<stamp>/{summary.json,<run>/gallery.png,<run>/states.json,<run>/crops/*.png};
// `latest` links the newest. Exit 1 when the gallery is empty or a run fails.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { focusChange } from "../lib/statesJudge.mjs";
import { summarizeStates } from "./judge.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const OUT = path.join(REPO, ".ui-capture", "states");
const DIST = path.join(OUT, "dist");

export const RUNS = [
  { id: "webkit-light", engine: "webkit", theme: "light" },
  { id: "webkit-dark", engine: "webkit", theme: "dark" },
  { id: "chromium-forced-light", engine: "chromium", theme: "light", context: { forcedColors: "active" } },
  { id: "chromium-forced-dark", engine: "chromium", theme: "dark", context: { forcedColors: "active" } },
];

/** Static state pairs judged against the same control's other instance. */
const PAIRS = [
  ["default", "disabled"],
  ["default", "loading"],
  ["default", "aria-disabled"],
  ["default", "error"],
  ["default", "checked"],
  ["selected", "default"],
  ["checked", "checked-disabled"],
];

const FREEZE = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}";

function parseArgs(argv) {
  const opts = { build: true, runs: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--no-build") opts.build = false;
    else if (argv[i] === "--runs") opts.runs = argv[(i += 1)].split(",");
    else if (argv[i] === "--help") opts.help = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return opts;
}

function build() {
  const env = { ...process.env, UI_STATES_OUT: DIST };
  delete env.NODE_ENV;
  const result = spawnSync(process.execPath, [path.join(REPO, "node_modules", "vite", "bin", "vite.js"), "build", "--config", path.join(HERE, "vite.config.mjs")], {
    cwd: REPO,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`gallery build failed (exit ${result.status})`);
}

function serve(dir) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const file = path.join(dir, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const safe = (name) => name.replace(/[^a-z0-9_-]+/gi, "_");

async function clipOf(handle, pad = 5) {
  const box = await handle.boundingBox();
  if (!box) return null;
  return { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
}

/** Keyboard focus on `handle`: focus the previous focusable, then Tab (Alt+Tab in WebKit). */
async function keyboardFocus(page, handle, tabKey) {
  const prepared = await handle.evaluate((el) => {
    const focusables = [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex],[role=tab],[role=switch],[role=combobox]")].filter(
      (e) => !e.disabled && e.tabIndex >= 0 && e.getBoundingClientRect().width > 0,
    );
    const index = focusables.indexOf(el);
    if (index > 0) focusables[index - 1].setAttribute("data-prev-focus", "1");
    return { focusable: !el.disabled && el.tabIndex >= 0, index };
  });
  if (!prepared.focusable) return { focusable: false };
  const prev = await page.$("[data-prev-focus='1']");
  if (prev) {
    await prev.focus();
    await page.keyboard.press(tabKey);
    await prev.evaluate((e) => e.removeAttribute("data-prev-focus"));
  } else {
    await page.keyboard.press(tabKey);
  }
  let reached = await handle.evaluate((el) => document.activeElement === el);
  if (!reached) {
    await handle.focus();
    reached = await handle.evaluate((el) => document.activeElement === el);
  }
  return { focusable: true, reached, focusVisibleMatches: await handle.evaluate((el) => el.matches(":focus-visible")) };
}

async function probeControl(page, handle, { name, tabKey, cropsDir, skipActive }) {
  await handle.scrollIntoViewIfNeeded().catch(() => {});
  await page.mouse.move(1, 1);
  const clip = await clipOf(handle);
  if (!clip) return { name, error: "no box" };
  const shot = () => page.screenshot({ clip, animations: "disabled", caret: "hide" });
  const rest = await shot();
  const row = { name, clip: [clip.x, clip.y, clip.width, clip.height].map(Math.round) };
  // hover
  await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
  await page.waitForTimeout(30);
  const hovered = await shot();
  row.hover = focusChange(rest, hovered);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(30);
  // keyboard focus
  const focus = await keyboardFocus(page, handle, tabKey);
  row.focusable = focus.focusable;
  if (focus.focusable) {
    const focused = await shot();
    row.focus = { ...focusChange(rest, focused), reached: focus.reached, focusVisibleMatches: focus.focusVisibleMatches };
    fs.writeFileSync(path.join(cropsDir, `${safe(name)}--focus.png`), focused);
    await handle.evaluate((el) => el.blur());
  }
  // pressed (vs hover: the pointer is over it in both)
  if (!skipActive) {
    await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(30);
    const pressed = await shot();
    row.active = focusChange(hovered, pressed);
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await page.keyboard.press("Escape").catch(() => {});
  }
  fs.writeFileSync(path.join(cropsDir, `${safe(name)}--rest.png`), rest);
  return row;
}

async function measureRun(run, origin, runDir) {
  const browser = run.engine === "chromium" ? await chromium.launch() : await webkit.launch();
  const tabKey = run.engine === "webkit" ? "Alt+Tab" : "Tab";
  const cropsDir = path.join(runDir, "crops");
  fs.mkdirSync(cropsDir, { recursive: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 1400 }, // the whole gallery (and the open menu) in view
      deviceScaleFactor: 2,
      colorScheme: run.theme,
      reducedMotion: "reduce",
      ...(run.context ?? {}),
    });
    const page = await context.newPage();
    await page.goto(`${origin}/?theme=${run.theme}`);
    await page.waitForSelector("[data-gallery-ready]");
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: FREEZE });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(runDir, "gallery.png"), fullPage: true });
    const handles = await page.$$("[data-ctl]");
    const rows = [];
    const byCtl = {};
    for (const handle of handles) {
      const ctl = await handle.getAttribute("data-ctl");
      const src = await handle.getAttribute("data-src");
      (byCtl[ctl] ??= {})[src] = handle;
      if (ctl === "menu:trigger") continue;
      // Only the interactive instances get hover/focus/pressed; static states are compared below.
      if (!["default", "selected", "checked"].includes(src)) continue;
      try {
        const row = await probeControl(page, handle, { name: `${run.id}:${ctl}:${src}`, tabKey, cropsDir, skipActive: ctl.startsWith("menu") });
        rows.push({ ctl, src, ...row });
      } catch (error) {
        rows.push({ ctl, src, error: String(error?.message ?? error).split("\n")[0] });
      }
    }
    const pairs = [];
    for (const [ctl, states] of Object.entries(byCtl)) {
      for (const [a, b] of PAIRS) {
        if (!states[a] || !states[b]) continue;
        await page.mouse.move(1, 1);
        await states[a].scrollIntoViewIfNeeded().catch(() => {});
        const ca = await clipOf(states[a]);
        const cb = await clipOf(states[b]);
        if (!ca || !cb) continue;
        const shotA = await page.screenshot({ clip: ca, animations: "disabled", caret: "hide" });
        const shotB = await page.screenshot({ clip: cb, animations: "disabled", caret: "hide" });
        pairs.push({ ctl, a, b, ...focusChange(shotA, shotB) });
      }
    }
    const ariaDisabled = await page.$$eval("[data-src=aria-disabled]", (els) =>
      els.map((e) => ({ ctl: e.getAttribute("data-ctl"), pointerEvents: getComputedStyle(e).pointerEvents, opacity: getComputedStyle(e).opacity, cursor: getComputedStyle(e).cursor })),
    );
    const summary = summarizeStates(rows);
    const result = { run, tabKey, summary, rows, pairs, ariaDisabled };
    fs.writeFileSync(path.join(runDir, "states.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    await browser.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("usage: pnpm ui:states [--no-build] [--runs webkit-light,webkit-dark,chromium-forced-light,chromium-forced-dark]");
    return 0;
  }
  if (opts.build) build();
  if (!fs.existsSync(path.join(DIST, "index.html"))) throw new Error(`missing ${DIST}/index.html (drop --no-build)`);
  const runs = opts.runs ? RUNS.filter((r) => opts.runs.includes(r.id)) : RUNS;
  if (runs.length === 0) throw new Error(`--runs matches none of ${RUNS.map((r) => r.id).join(", ")}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const outDir = path.join(OUT, stamp);
  const server = await serve(DIST);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const failures = [];
  const summary = {};
  try {
    for (const run of runs) {
      const runDir = path.join(outDir, run.id);
      fs.mkdirSync(runDir, { recursive: true });
      try {
        const result = await measureRun(run, origin, runDir);
        summary[run.id] = result.summary;
        failures.push(...result.summary.failures.map((f) => `${run.id}: ${f}`));
        const s = result.summary;
        console.log(`  ${run.id.padEnd(22)} focus ${s.focus.visible}/${s.focus.population} · hover ${s.hover.visible}/${s.hover.population} · pressed ${s.active.visible}/${s.active.population}`);
      } catch (error) {
        failures.push(`${run.id}: ${String(error?.message ?? error).split("\n")[0]}`);
      }
    }
  } finally {
    server.close();
  }
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ runs: summary, failures }, null, 2) + "\n");
  const latest = path.join(OUT, "latest");
  fs.rmSync(latest, { force: true });
  fs.symlinkSync(stamp, latest);
  console.log(`▸ states: ${path.relative(REPO, outDir)}`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`✗ ${error?.message ?? error}`);
    process.exit(1);
  },
);
