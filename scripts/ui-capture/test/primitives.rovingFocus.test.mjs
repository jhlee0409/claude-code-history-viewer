// Real-browser controlled radio entry versus focus-based toolbar roving.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { REPO, buildGallery, openGalleryPage, serveDir } from "../states/lib.mjs";

/* global document */
const ENABLED = browserRequirement({ webkit: true, chromium: true }, { label: "primitives.rovingFocus" }).enabled;
let outDir, server, origin;
const browsers = {};
beforeAll(async () => {
  if (!ENABLED) return;
  outDir = path.join(REPO, ".ui-capture", `roving-test-${process.pid}`);
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
async function pageFor(engine, policy, fn) {
  const context = await browsers[engine].newContext({ locale: "en-US", viewport: { width: 1200, height: 900 } });
  const errors = [];
  try {
    const page = await openGalleryPage(context, origin, "light", `roving&policy=${policy}`);
    page.on("pageerror", (error) => errors.push(error.message));
    await fn(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
}
// macOS WebKit uses Option+Tab to include buttons in native tab traversal.
const tabKey = (engine, backwards = false) => `${backwards ? "Shift+" : ""}${engine === "webkit" ? "Alt+" : ""}Tab`;
const focused = async (locator) => expect(await locator.evaluate((el) => document.activeElement === el)).toBe(true);
async function soleStop(group, name) {
  expect(await group.locator('[tabindex="0"]').count()).toBe(1);
  expect(await group.locator('[tabindex="0"]').textContent()).toBe(name);
}
async function reenter(page, engine, group, expected, after, before) {
  // No focus() substitution: assert native exit and entry in both directions.
  await page.keyboard.press(tabKey(engine));
  await focused(page.locator(after));
  await page.keyboard.press(tabKey(engine, true));
  await focused(group.getByRole("radio", { name: expected, exact: true }));
  await page.keyboard.press(tabKey(engine, true));
  await focused(page.locator(before));
  await page.keyboard.press(tabKey(engine));
  await focused(group.getByRole("radio", { name: expected, exact: true }));
  await soleStop(group, expected);
}

describe.skipIf(!ENABLED)("controlled radio and toolbar keyboard contracts", () => {
  for (const engine of ["webkit", "chromium"]) {
    for (const policy of ["accept", "reject", "defer"]) {
      it(`${engine}: ${policy} selection keeps checked Tab entry through exit and re-entry`, async () => {
        await pageFor(engine, policy, async (page) => {
          const group = page.getByRole("radiogroup", { name: "Controlled radios" });
          const a = group.getByRole("radio", { name: "A", exact: true });
          const b = group.getByRole("radio", { name: "B", exact: true });
          await page.locator("[data-before-radio]").focus();
          await page.keyboard.press(tabKey(engine));
          await focused(a);
          await page.keyboard.press("ArrowRight");
          await focused(b);
          expect(await page.locator("[data-requests]").textContent()).toBe('["b"]');
          expect(await a.getAttribute("aria-checked")).toBe(policy === "accept" ? "false" : "true");
          expect(await b.getAttribute("aria-checked")).toBe(policy === "accept" ? "true" : "false");
          await reenter(page, engine, group, policy === "accept" ? "B" : "A", "[data-after-radio]", "[data-before-radio]");
          if (policy === "defer") {
            await page.getByRole("button", { name: "Resolve request", exact: true }).click();
            await page.waitForFunction(() => document.querySelector('[role="radio"][aria-checked="true"]')?.textContent === "B");
            await soleStop(group, "B");
            await page.locator("[data-before-radio]").focus();
            await page.keyboard.press(tabKey(engine));
            await focused(b);
            await reenter(page, engine, group, "B", "[data-after-radio]", "[data-before-radio]");
          }
        });
      });
    }
    it(`${engine}: rejected pointer and Space/Enter requests never replace the checked Tab stop`, async () => {
      await pageFor(engine, "reject", async (page) => {
        const group = page.getByRole("radiogroup", { name: "Controlled radios" });
        const b = group.getByRole("radio", { name: "B", exact: true });
        // Explicit focus also covers WebKit, where clicking a button need not focus it.
        await b.focus();
        await b.click();
        await page.keyboard.press("Space");
        await page.keyboard.press("Enter");
        expect(await page.locator("[data-requests]").textContent()).toBe('["b","b","b"]');
        await focused(b);
        await soleStop(group, "A");
        await reenter(page, engine, group, "A", "[data-after-radio]", "[data-before-radio]");
      });
    });
    for (const policy of ["accept", "reject", "defer"]) {
      it(`${engine}: ${policy} arrows wrap, Home/End skip disabled items, and entry survives disable/reorder`, async () => {
        await pageFor(engine, policy, async (page) => {
          const group = page.getByRole("radiogroup", { name: "Controlled radios" });
          await group.getByRole("radio", { name: "A", exact: true }).focus();
          for (const [key, name] of [["ArrowLeft", "C"], ["ArrowRight", "A"], ["ArrowUp", "C"], ["ArrowDown", "A"], ["End", "C"], ["Home", "A"], ["ArrowRight", "B"]]) {
            await page.keyboard.press(key);
            await focused(group.getByRole("radio", { name, exact: true }));
            const checked = policy === "accept" ? name : "A";
            expect(await group.getByRole("radio", { name: checked, exact: true }).getAttribute("aria-checked")).toBe("true");
            await soleStop(group, checked);
          }
          expect(await page.locator("[data-requests]").textContent()).toBe('["c","a","c","a","c","a","b"]');
          await page.getByRole("button", { name: "Disable B", exact: true }).click();
          expect(await group.getByRole("radio", { name: "B", exact: true }).isDisabled()).toBe(true);
          await soleStop(group, "A");
          await page.locator("[data-before-radio]").focus();
          await page.keyboard.press(tabKey(engine));
          await page.keyboard.press("ArrowRight");
          await focused(group.getByRole("radio", { name: "C", exact: true }));
          await page.getByRole("button", { name: "Reorder", exact: true }).click();
          const entry = policy === "accept" ? "C" : "A";
          await soleStop(group, entry);
          await page.locator("[data-before-radio]").focus();
          await page.keyboard.press(tabKey(engine));
          await focused(group.getByRole("radio", { name: entry, exact: true }));
          await group.getByRole("radio", { name: "C", exact: true }).focus();
          await page.keyboard.press("ArrowRight");
          await focused(group.getByRole("radio", { name: "A", exact: true }));
          await page.keyboard.press("ArrowLeft");
          if (policy !== "accept") {
            // Unchecked C precedes the checked entry after reordering: native
            // Tab visits that sole stop before leaving the group.
            await page.keyboard.press(tabKey(engine));
            await focused(group.getByRole("radio", { name: "A", exact: true }));
          }
          await reenter(page, engine, group, entry, "[data-after-radio]", "[data-before-radio]");
          if (policy !== "accept") {
            await page.getByRole("button", { name: "Disable A", exact: true }).click();
            // No enabled checked item: first available in the new DOM order.
            await soleStop(group, "C");
            await page.locator("[data-before-radio]").focus();
            await page.keyboard.press(tabKey(engine));
            await focused(group.getByRole("radio", { name: "C", exact: true }));
            await page.keyboard.press("ArrowRight");
            await focused(group.getByRole("radio", { name: "B", exact: true }));
            await soleStop(group, "C");
            await reenter(page, engine, group, "C", "[data-after-radio]", "[data-before-radio]");
          }
        });
      });
    }
    it(`${engine}: RTL changes horizontal radio and toolbar movement without changing their entry policies`, async () => {
      await pageFor(engine, "reject", async (page) => {
        const radios = page.getByRole("radiogroup", { name: "Controlled radios" });
        const toolbar = page.getByRole("toolbar", { name: "Independent filters" });
        await radios.evaluate((el) => { el.dir = "rtl"; });
        await toolbar.evaluate((el) => { el.dir = "rtl"; });
        await radios.getByRole("radio", { name: "A", exact: true }).focus();
        for (const [key, name] of [["ArrowRight", "C"], ["ArrowLeft", "A"], ["ArrowDown", "B"], ["ArrowUp", "A"]]) {
          await page.keyboard.press(key);
          await focused(radios.getByRole("radio", { name, exact: true }));
          await soleStop(radios, "A");
        }
        expect(await page.locator("[data-requests]").textContent()).toBe('["c","a","b","a"]');
        const a = toolbar.getByRole("button", { name: "A", exact: true });
        await a.focus();
        await page.keyboard.press("ArrowRight");
        await focused(toolbar.getByRole("button", { name: "Reset", exact: true }));
        await soleStop(toolbar, "Reset");
        await page.keyboard.press("ArrowLeft");
        await focused(a);
        expect(await a.getAttribute("aria-pressed")).toBe("false");
        await soleStop(toolbar, "A");
      });
    });
    it(`${engine}: toolbar entry follows focus, not pressed state, including Reset and disable/reorder`, async () => {
      await pageFor(engine, "reject", async (page) => {
        const group = page.getByRole("toolbar", { name: "Independent filters" });
        const a = group.getByRole("button", { name: "A", exact: true });
        const b = group.getByRole("button", { name: "B", exact: true });
        const c = group.getByRole("button", { name: "C", exact: true });
        const reset = group.getByRole("button", { name: "Reset", exact: true });
        await a.focus();
        await page.keyboard.press("ArrowRight");
        await focused(b);
        await page.keyboard.press("ArrowRight");
        await focused(c);
        expect(await a.getAttribute("aria-pressed")).toBe("false");
        expect(await b.getAttribute("aria-pressed")).toBe("true");
        expect(await c.getAttribute("aria-pressed")).toBe("false");
        await soleStop(group, "C");
        await page.keyboard.press(tabKey(engine));
        await focused(page.locator("[data-after-toolbar]"));
        await page.keyboard.press(tabKey(engine, true));
        await focused(c);
        await page.keyboard.press("Space");
        expect(await c.getAttribute("aria-pressed")).toBe("true");
        expect(await b.getAttribute("aria-pressed")).toBe("true");
        await page.keyboard.press("End");
        await focused(reset);
        await page.keyboard.press("ArrowRight");
        await focused(a);
        await page.getByRole("button", { name: "Disable B", exact: true }).click();
        await a.focus();
        await page.keyboard.press("ArrowRight");
        await focused(c);
        await page.getByRole("button", { name: "Reorder", exact: true }).click();
        await c.focus();
        await page.keyboard.press("ArrowRight");
        await focused(a);
        await soleStop(group, "A");
        await page.keyboard.press(tabKey(engine, true));
        await focused(page.locator("[data-before-toolbar]"));
        await page.keyboard.press(tabKey(engine));
        await focused(a);
      });
    });
  }
});
