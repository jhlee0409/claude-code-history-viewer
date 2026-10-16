#!/usr/bin/env node
// Conversation-tab timing (plan §4.3 / §9b F6), measured on the harness
// build and fixture with a real clock (the capture harness pauses time, so
// timing runs here instead):
//
//   switch   switching back to the 1,369-message tab, warm backend cache:
//            click → its saved anchor message is on screen and the app is
//            settled (data-ready). Target: median ≤ 500 ms.
//   first    the first activation after start: page load → the restored
//            tab's anchor is on screen. Target: median ≤ 1,500 ms.
//   oldPage  switching back when the anchor lives in an older page (it has
//            to be paged in first). Target: median ≤ 2,000 ms.
//
// Each case runs 10 times; median and p90 are written to <out>/timing.json.
//
//   node scripts/ui-capture/measure-tabs.mjs [--runs 10] [--out scratch/t8/timing] [--width 1440 --height 900]
//
// Reuses .ui-capture/build/{dist,cchv-server} (run the capture once first).

/* global document, window, performance, localStorage */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkit } from "playwright";
import { generateFixture } from "./fixtures/generate.mjs";
import { startServer } from "./lib/server.mjs";
import { withServerAndBrowser } from "./lib/lifecycle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const BUILD = path.join(REPO, ".ui-capture/build");
const FIXTURE_ROOT = path.join(REPO, ".ui-capture/fixture");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const RUNS = Number(flag("runs", 10));
const OUT = path.resolve(flag("out", path.join(REPO, "scratch/t8/timing")));
const VIEWPORT = { width: Number(flag("width", 1440)), height: Number(flag("height", 900)) };
const TARGETS = { switch: 500, first: 1500, oldPage: 2000 };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p90 = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
};
const round = (n) => Math.round(n);

/** In the page: the transcript viewport and the first visible message (uuid, offset). */
const READ_ANCHOR = `(() => {
  const rows = [...document.querySelectorAll('#main-content [data-message-uuid]')];
  const viewport = rows[0]?.closest('[data-overlayscrollbars-viewport]') ?? null;
  if (!viewport) return null;
  const top = viewport.getBoundingClientRect().top;
  const row = rows.find((r) => r.getBoundingClientRect().bottom > top + 1);
  return row ? { uuid: row.getAttribute('data-message-uuid'), offset: row.getBoundingClientRect().top - top } : null;
})()`;

/** Wait (rAF polling) until message `uuid` is on screen and the app settled; resolve performance.now(). */
const anchorShown = (uuid) => `new Promise((resolve, reject) => {
  const started = performance.now();
  const check = () => {
    if (performance.now() - started > 10000) {
      reject(new Error('anchor ${uuid} not on screen after 10 s'));
      return;
    }
    const el = document.querySelector('#main-content [data-message-uuid="${uuid}"]');
    const viewport = el?.closest('[data-overlayscrollbars-viewport]');
    const ready = document.querySelector('[data-ready]')?.getAttribute('data-ready') === 'true';
    if (el && viewport && ready) {
      const box = el.getBoundingClientRect();
      const vp = viewport.getBoundingClientRect();
      if (box.bottom > vp.top && box.top < vp.bottom) {
        resolve({ at: performance.now(), offset: box.top - vp.top });
        return;
      }
    }
    requestAnimationFrame(check);
  };
  check();
})`;

async function main() {
  const binary = path.join(BUILD, "cchv-server");
  const dist = path.join(BUILD, "dist");
  if (!fs.existsSync(binary) || !fs.existsSync(dist)) {
    throw new Error("no harness build: run `node scripts/ui-capture/run.mjs --only tabs-three` first");
  }
  fs.mkdirSync(OUT, { recursive: true });
  const fixture = generateFixture({ root: FIXTURE_ROOT });
  const large = fixture.largeSession.title;
  const other = fixture.projects[0].sessions[2].title;
  const featured = fixture.projects[0];

  const results = { switch: [], first: [], oldPage: [], anchorDrift: [] };
  await withServerAndBrowser(
    {
      startServer: () => startServer({ binary, dist, home: fixture.home, fixtureRoot: FIXTURE_ROOT, logFile: path.join(OUT, "server.log") }),
      launchBrowser: () => webkit.launch(),
    },
    async ({ server, browser }) => {
      const context = await browser.newContext({ viewport: VIEWPORT, locale: "ko-KR", timezoneId: "Asia/Seoul", reducedMotion: "reduce" });
      const page = await context.newPage();
      const ready = () => page.waitForSelector('[data-ready="true"]', { timeout: 30_000 });
      await page.goto(`${server.origin}/`);
      await ready();

      // Tab 1: the large session; tab 2: a small one, opened with ⌘+click.
      await page.locator(`[data-tree-node="project"][data-project-path=${JSON.stringify(featured.appPath)}]`).first().click();
      await ready();
      await page.getByRole("tree").getByText(large.slice(0, 40)).first().click();
      await ready();
      await page.waitForSelector("#main-content [data-message-uuid]");
      await page.waitForTimeout(800);
      const tab = (i) => page.locator('[data-slot="tabs"] [role="tab"]').nth(i);

      // Park tab 1 in the middle of its loaded window.
      const parkMiddle = async () => {
        await page.evaluate(() => {
          const vp = document.querySelector('#main-content [data-message-uuid]')?.closest("[data-overlayscrollbars-viewport]");
          if (vp) vp.scrollTop = vp.scrollHeight * 0.45;
        });
        await page.waitForTimeout(400);
        return page.evaluate(READ_ANCHOR);
      };
      let anchor = await parkMiddle();
      await page.getByRole("tree").getByText(other.slice(0, 40)).first().click({ modifiers: ["ControlOrMeta"] });
      await ready();
      await page.waitForTimeout(400);

      const switchTo = async (i, uuid) => {
        await page.evaluate(() => {
          window.__tabT0 = performance.now();
        });
        await tab(i).click();
        const shown = await page.evaluate(anchorShown(uuid));
        const t0 = await page.evaluate(() => window.__tabT0);
        return { ms: shown.at - t0, offset: shown.offset };
      };
      const lastOf = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll("#main-content [data-message-uuid]")];
        return rows[rows.length - 1]?.getAttribute("data-message-uuid") ?? null;
      });

      const log = (...parts) => console.error(new Date().toISOString().slice(11, 19), ...parts);
      log("tabs open; anchor", anchor);
      // (a) warm switch, 10 round trips; the large tab's anchor each time.
      for (let run = 0; run < RUNS; run += 1) {
        const back = await switchTo(0, anchor.uuid);
        results.switch.push(back.ms);
        log("switch", run, Math.round(back.ms), "drift", Math.round(back.offset - anchor.offset));
        results.anchorDrift.push(Math.abs(back.offset - anchor.offset));
        await page.waitForTimeout(300);
        anchor = (await page.evaluate(READ_ANCHOR)) ?? anchor;
        const small = await lastOf();
        await tab(1).click();
        await ready();
        if (small) await page.waitForTimeout(300);
      }

      // (c) an anchor in an older page: page in older messages in tab 1,
      // park there, leave, come back.
      for (let run = 0; run < RUNS; run += 1) {
        await tab(0).click();
        await ready();
        await page.waitForTimeout(800);
        for (let k = 0; k < 3; k += 1) {
          await page.evaluate(() => {
            const vp = document.querySelector("#main-content [data-message-uuid]")?.closest("[data-overlayscrollbars-viewport]");
            if (vp) vp.scrollTop = 0;
          });
          await page.waitForTimeout(700);
          await ready();
        }
        const old = await page.evaluate(READ_ANCHOR);
        await tab(1).click();
        await ready();
        await page.waitForTimeout(300);
        const back = await switchTo(0, old.uuid);
        results.oldPage.push(back.ms);
        log("oldPage", run, Math.round(back.ms), old.uuid);
      }

      // (b) first activation after start: the restored tab 1 (stored anchor).
      await tab(0).click();
      await ready();
      await page.waitForTimeout(800); // the anchor restore's last pass (450 ms)
      anchor = await parkMiddle();
      await page.waitForTimeout(600); // tabs.v1 is saved after 400 ms of quiet
      for (let run = 0; run < RUNS; run += 1) {
        await page.reload();
        const shown = await page.evaluate(anchorShown(anchor.uuid));
        results.first.push(shown.at);
        log("first", run, Math.round(shown.at));
        await page.waitForTimeout(600);
      }
      await context.close();
    },
  );

  const summary = Object.fromEntries(
    ["switch", "first", "oldPage"].map((key) => [
      key,
      {
        runs: results[key].map(round),
        median: round(median(results[key])),
        p90: round(p90(results[key])),
        targetMedian: TARGETS[key],
        pass: median(results[key]) <= TARGETS[key],
      },
    ]),
  );
  summary.anchorDriftPx = { median: round(median(results.anchorDrift)), max: round(Math.max(...results.anchorDrift)) };
  summary.environment = {
    build: "harness: vite production dist + cchv-server debug build (--serve --no-watch), WebKit (Playwright)",
    viewport: VIEWPORT,
    fixture: "1,369-message session (scripts/ui-capture/fixtures)",
    host: process.platform,
  };
  fs.writeFileSync(path.join(OUT, "timing.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
