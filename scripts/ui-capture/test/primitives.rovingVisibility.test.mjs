// Real layout and native Tab: no client-rect mocks or rerenders to repair entry.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { REPO, buildGallery, openGalleryPage, serveDir } from "../states/lib.mjs";

/* global document, getComputedStyle */
const ENABLED = browserRequirement({ webkit: true, chromium: true }, { label: "primitives.rovingVisibility" }).enabled;
let outDir, server, origin;
const browsers = {};
beforeAll(async () => {
  if (!ENABLED) return;
  outDir = path.join(REPO, ".ui-capture", `roving-visibility-${process.pid}`);
  buildGallery(path.join(outDir, "dist"));
  server = await serveDir(path.join(outDir, "dist"));
  origin = `http://127.0.0.1:${server.address().port}`;
  browsers.webkit = await webkit.launch();
  browsers.chromium = await chromium.launch();
}, 240_000);
afterAll(async () => {
  await Promise.all(Object.values(browsers).map((browser) => browser.close()));
  server?.close();
  if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
});
const tabKey = (engine, back = false) => `${back ? "Shift+" : ""}${engine === "webkit" ? "Alt+" : ""}Tab`;
const focused = async (item) => expect(await item.evaluate((el) => document.activeElement === el)).toBe(true);
const item = (group, name) => group.locator(`[data-roving-item="${name.toLowerCase()}"]`);
async function stop(group, name) {
  await expect.poll(() => group.locator('[tabindex="0"]').allTextContents()).toEqual([name]);
  const geometry = await group.locator('[tabindex="0"]').evaluate((el) => ({ rects: el.getClientRects().length, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  expect(geometry.rects).toBeGreaterThan(0);
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
}
async function enter(page, engine, group, name, family) {
  await page.locator(`[data-before-${family}]`).focus();
  await page.keyboard.press(tabKey(engine));
  await focused(item(group, name));
  await stop(group, name);
}
async function withPage(engine, visibility, fn) {
  const context = await browsers[engine].newContext({ locale: "en-US", viewport: { width: 1200, height: 900 } });
  const errors = [];
  context.on("weberror", (error) => errors.push(error.error().message));
  try {
    const page = await openGalleryPage(context, origin, "light", `roving&policy=reject&visibility=${visibility}`);
    await fn(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}

describe.skipIf(!ENABLED)("CSS visibility and effective roving direction", () => {
  for (const engine of ["webkit", "chromium"]) {
    for (const [directionCase, expectedDirection] of [["inherited RTL", "rtl"], ["local LTR inside RTL", "ltr"], ["CSS RTL", "rtl"], ["CSS LTR overrides RTL dir", "ltr"], ["inherited CSS RTL", "rtl"]]) {
      it(`${engine}: ${directionCase} follows effective group direction`, async () => {
        await withPage(engine, "visible", async (page) => {
          for (const [role, family] of [["radiogroup", "radio"], ["toolbar", "toolbar"]]) {
            const group = page.getByRole(role);
            await group.evaluate((el, mode) => {
              const ancestor = el.parentElement;
              ancestor.removeAttribute("dir");
              ancestor.style.direction = "";
              el.removeAttribute("dir");
              el.style.direction = "";
              if (mode === "inherited RTL" || mode === "local LTR inside RTL") ancestor.dir = "rtl";
              if (mode === "local LTR inside RTL") el.dir = "ltr";
              if (mode === "CSS RTL") el.style.direction = "rtl";
              if (mode === "CSS LTR overrides RTL dir") { el.dir = "rtl"; el.style.direction = "ltr"; }
              if (mode === "inherited CSS RTL") ancestor.style.direction = "rtl";
            }, directionCase);
            expect(await group.evaluate((el) => getComputedStyle(el).direction)).toBe(expectedDirection);
            await enter(page, engine, group, "A", family);
            const right = expectedDirection === "rtl" ? (family === "radio" ? "C" : "Reset") : "B";
            await page.keyboard.press("ArrowRight");
            const target = right === "Reset" ? group.getByRole("button", { name: "Reset", exact: true }) : item(group, right);
            await focused(target);
            await stop(group, family === "radio" ? "A" : right);
            await page.keyboard.press("ArrowLeft");
            await focused(item(group, "A"));
            await page.keyboard.press("ArrowDown");
            await focused(item(group, "B"));
            await page.keyboard.press("ArrowUp");
            await focused(item(group, "A"));
            await stop(group, "A");
            await page.keyboard.press(tabKey(engine));
            await focused(page.locator(`[data-after-${family}]`));
            await page.keyboard.press(tabKey(engine, true));
            await focused(item(group, "A"));
          }
        });
      });
    }
    for (const visibility of ["first", "middle", "ancestor", "selected"]) {
      it(`${engine}: ${visibility} hidden items leave visible entry and native arrows`, async () => {
        await withPage(engine, visibility, async (page) => {
          for (const [role, family] of [["radiogroup", "radio"], ["toolbar", "toolbar"]]) {
            const group = page.getByRole(role);
            const hidden = visibility === "middle" || visibility === "selected" ? "B" : "A";
            expect(await item(group, hidden).evaluate((el) => el.getClientRects().length)).toBe(0);
            const entry = hidden === "A" ? "B" : "A";
            await stop(group, entry);
            await enter(page, engine, group, entry, family);
            await page.keyboard.press("ArrowRight");
            await focused(item(group, "C"));
            await stop(group, family === "radio" ? entry : "C");
            await page.keyboard.press("Home");
            await focused(item(group, entry));
            await page.keyboard.press("End");
            if (family === "radio") await focused(item(group, "C"));
            else await focused(group.getByRole("button", { name: "Reset", exact: true }));
            await page.keyboard.press(tabKey(engine));
            await focused(page.locator(`[data-after-${family}]`));
            await page.keyboard.press(tabKey(engine, true));
            if (family === "radio") await focused(item(group, entry));
            else await focused(group.getByRole("button", { name: "Reset", exact: true }));
            expect(await group.getByRole(family === "radio" ? "radio" : "button", { name: "Locked", includeHidden: true }).getAttribute("tabindex")).toBe("-1");
          }
          // Rejection stays controlled even when its checked item is hidden.
          expect(await page.getByRole("radiogroup").locator('[aria-checked="true"]').textContent()).toBe(visibility === "selected" ? "B" : "A");
          expect(await page.locator("[data-requests]").textContent()).not.toBe("[]");
        });
      });
    }
    it(`${engine}: responsive hide/reveal and runtime ancestor hide repair entry without React renders`, async () => {
      await withPage(engine, "responsive", async (page) => {
        const radios = page.getByRole("radiogroup");
        const toolbar = page.getByRole("toolbar");
        for (const [width, entry, toolbarEntry] of [[1200, "A", "A"], [700, "B", "B"], [1200, "A", "B"], [700, "B", "B"]]) {
          await page.setViewportSize({ width, height: 900 });
          await stop(radios, entry);
          await enter(page, engine, radios, entry, "radio");
          await page.keyboard.press("ArrowRight");
          await focused(item(radios, entry === "A" ? "B" : "C"));
          // Toolbar retains its last visible focus stop, unlike checked radios.
          await stop(toolbar, toolbarEntry);
        }
        await page.setViewportSize({ width: 1200, height: 900 });
        await stop(radios, "A");
        await item(toolbar, "B").focus();
        await stop(toolbar, "B");
        // Change CSS on wrappers only, not React state or the group itself.
        for (const group of [radios, toolbar]) {
          await group.evaluate((el) => { el.style.width = "500px"; el.style.height = "60px"; });
          const before = await group.boundingBox();
          await group.locator('[data-roving-wrap="a"], [data-roving-wrap="b"]').evaluateAll((els) => els.forEach((el) => el.setAttribute("data-runtime-hidden", "")));
          await stop(group, "C");
          const after = await group.boundingBox();
          expect([after.width, after.height]).toEqual([before.width, before.height]);
        }
        await enter(page, engine, radios, "C", "radio");
        await page.keyboard.press("ArrowRight");
        await focused(item(radios, "C"));
        await enter(page, engine, toolbar, "C", "toolbar");
        await page.keyboard.press("ArrowRight");
        await focused(toolbar.getByRole("button", { name: "Reset", exact: true }));
        for (const group of [radios, toolbar]) await group.locator("[data-runtime-hidden]").evaluateAll((els) => els.forEach((el) => el.removeAttribute("data-runtime-hidden")));
        await stop(radios, "A");
        await stop(toolbar, "Reset");
        await enter(page, engine, radios, "A", "radio");
        await page.keyboard.press("ArrowRight");
        await focused(item(radios, "B"));
        await stop(radios, "A");
        // No available item means no Tab stop; revealing restores real entry.
        for (const [group, family] of [[radios, "radio"], [toolbar, "toolbar"]]) {
          await page.locator(`[data-before-${family}]`).focus();
          await group.locator("button").evaluateAll((els) => els.forEach((el) => el.setAttribute("data-runtime-hidden", "")));
          await expect.poll(() => group.locator('[tabindex="0"]').count()).toBe(0);
          await page.keyboard.press(tabKey(engine));
          await focused(page.locator(`[data-after-${family}]`));
          await group.locator("button").evaluateAll((els) => els.forEach((el) => el.removeAttribute("data-runtime-hidden")));
          await stop(group, "A");
          await enter(page, engine, group, "A", family);
        }
      });
    });
  }
});
