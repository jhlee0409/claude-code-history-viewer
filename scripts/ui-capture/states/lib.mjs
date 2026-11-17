// Build and serve the primitive states gallery (states/gallery.tsx), shared
// by `pnpm ui:states` (states/run.mjs) and the real-browser primitive tests
// (test/primitives.states.test.mjs).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STATES_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(STATES_DIR, "..", "..", "..");

/** vite build of the gallery into `outDir` (the real src/components/ui + index.css). */
export function buildGallery(outDir) {
  const env = { ...process.env, UI_STATES_OUT: outDir };
  delete env.NODE_ENV;
  const result = spawnSync(process.execPath, [path.join(REPO, "node_modules", "vite", "bin", "vite.js"), "build", "--config", path.join(STATES_DIR, "vite.config.mjs")], {
    cwd: REPO,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`gallery build failed (exit ${result.status})`);
}

/** A static server for `dir` on 127.0.0.1 (random port). */
export function serveDir(dir) {
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

/** Transitions, animations and the caret off: a state is captured as it settles. */
export const FREEZE = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}";

/** Open the gallery (or its `view`, e.g. "probes") in `context`'s new page, fonts loaded and motion frozen. */
export async function openGalleryPage(context, origin, theme, view) {
  const page = await context.newPage();
  await page.goto(`${origin}/?theme=${theme}${view ? `&view=${view}` : ""}`);
  await page.waitForSelector("[data-gallery-ready]");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: FREEZE });
  await page.waitForTimeout(100);
  return page;
}

/**
 * Keyboard focus on `handle` the way a user gets there: focus the focusable
 * control before it, then press `tabKey` (Alt+Tab in WebKit: its plain Tab
 * skips buttons). `{ focusable, reached, focusVisibleMatches, inView,
 * covered }`: reached = the key press landed on it; inView = its focus ring
 * box (outline offset + width outside the border box) is inside the
 * viewport; covered = another element sits on its centre.
 */
export async function keyboardFocus(page, handle, tabKey) {
  const prepared = await handle.evaluate((el) => {
    const focusables = [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex],[role=tab],[role=switch],[role=combobox]")].filter(
      (e) => !e.disabled && e.tabIndex >= 0 && e.getBoundingClientRect().width > 0,
    );
    const index = focusables.indexOf(el);
    if (index > 0) focusables[index - 1].setAttribute("data-prev-focus", "1");
    return { focusable: !el.disabled && el.tabIndex >= 0, index };
  });
  if (!prepared.focusable) return { focusable: false };
  // The first focusable control has nothing before it: a temporary sentinel
  // just before it takes that place (a Tab from the bare page lands on the
  // browser chrome or a dialog library's focus guard, not on the control).
  if (prepared.index <= 0) {
    await handle.evaluate((el) => {
      const sentinel = document.createElement("button");
      sentinel.setAttribute("data-prev-focus", "1");
      sentinel.setAttribute("data-focus-sentinel", "1");
      sentinel.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0";
      el.before(sentinel);
    });
  }
  const prev = await page.$("[data-prev-focus='1']");
  await prev.focus();
  await page.keyboard.press(tabKey);
  await prev.evaluate((e) => (e.hasAttribute("data-focus-sentinel") ? e.remove() : e.removeAttribute("data-prev-focus")));
  let reached = await handle.evaluate((el) => document.activeElement === el);
  if (!reached) await handle.focus();
  const geometry = await handle.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const reach = cs.outlineStyle === "none" ? 0 : (parseFloat(cs.outlineOffset) || 0) + (parseFloat(cs.outlineWidth) || 0);
    const ring = { left: r.left - reach, top: r.top - reach, right: r.right + reach, bottom: r.bottom + reach };
    const inView = ring.left >= 0 && ring.top >= 0 && ring.right <= innerWidth && ring.bottom <= innerHeight;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const covered = !hit || !(hit === el || el.contains(hit) || hit.contains(el));
    return { focusVisibleMatches: el.matches(":focus-visible"), inView, covered };
  });
  return { focusable: true, reached, ...geometry };
}
