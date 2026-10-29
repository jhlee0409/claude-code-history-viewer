// F2b keyboard/selected-state contracts, on real primitives and Radix widgets.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, webkit } from "playwright";
import { browserRequirement } from "./requirements.mjs";
import { REPO, buildGallery, openGalleryPage, serveDir } from "../states/lib.mjs";

/* global document, getComputedStyle */
const ENABLED = browserRequirement({ webkit: true, chromium: true }, { label: "primitives.adoption" }).enabled;
let outDir, server, origin;
const browsers = {};
beforeAll(async () => {
  if (!ENABLED) return;
  outDir = path.join(REPO, ".ui-capture", `adoption-test-${process.pid}`);
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
async function pageFor(engine, forcedColors, fn) {
  const context = await browsers[engine].newContext({ locale: "en-US", viewport: { width: 1200, height: 1500 }, reducedMotion: "reduce", ...(forcedColors ? { forcedColors: "active" } : {}) });
  try { await fn(await openGalleryPage(context, origin, "light", "adoption")); }
  finally { await context.close(); }
}
const tabKey = (engine) => engine === "webkit" ? "Alt+Tab" : "Tab";

describe.skipIf(!ENABLED)("F2b composed controls", () => {
  for (const engine of ["webkit", "chromium"]) {
    it(`${engine}: compact toolbar controls are 26px and header controls are 28px`, async () => {
      await pageFor(engine, false, async (page) => {
        for (const control of [
          page.getByRole("radio", { name: "Tokens", exact: true }),
          page.getByRole("button", { name: "User", exact: true }),
          page.getByRole("combobox", { name: "Choose provider" }),
        ]) {
          expect((await control.boundingBox()).height).toBe(26);
        }
        expect((await page.getByRole("combobox", { name: "Unavailable provider" }).boundingBox()).height).toBe(28);
        expect((await page.getByRole("radio", { name: "First", exact: true }).boundingBox()).height).toBe(28);
      });
    });
    it(`${engine}: radio arrows select and Tab exits the whole group`, async () => {
      await pageFor(engine, false, async (page) => {
        const group = page.getByRole("radiogroup", { name: "Metric" });
        const tokens = group.getByRole("radio", { name: "Tokens" });
        const cost = group.getByRole("radio", { name: "Cost (Est.)" });
        await tokens.focus();
        await page.keyboard.press("ArrowRight");
        expect(await cost.getAttribute("aria-checked")).toBe("true");
        expect(await cost.evaluate((el) => document.activeElement === el)).toBe(true);
        expect(await group.locator('[tabindex="0"]').count()).toBe(1);
        await page.keyboard.press(tabKey(engine));
        expect(await page.locator('[data-after-radio]').evaluate((el) => document.activeElement === el)).toBe(true);
      });
    });
    it(`${engine}: toolbar roves without selecting; Space toggles only the focused filter`, async () => {
      await pageFor(engine, false, async (page) => {
        const group = page.getByRole("toolbar", { name: "Probe filters" });
        const user = group.getByRole("button", { name: "User" });
        const assistant = group.getByRole("button", { name: "Assistant" });
        await user.focus();
        await page.keyboard.press("ArrowRight");
        expect(await assistant.evaluate((el) => document.activeElement === el)).toBe(true);
        expect(await assistant.getAttribute("aria-pressed")).toBe("false");
        await page.keyboard.press("Space");
        expect(await assistant.getAttribute("aria-pressed")).toBe("true");
        expect(await user.getAttribute("aria-pressed")).toBe("true");
        await page.keyboard.press("ArrowRight");
        expect(await user.evaluate((el) => document.activeElement === el)).toBe(true);
        expect(await group.locator('[tabindex="0"]').count()).toBe(1);
        await page.keyboard.press(tabKey(engine));
        expect(await page.locator('[data-after-toolbar]').evaluate((el) => document.activeElement === el)).toBe(true);
      });
    });
    it(`${engine}: actual Radix tabs and Select keep keyboard selection and inactive controls inert`, async () => {
      await pageFor(engine, false, async (page) => {
        await page.getByRole("tab", { name: "Overview", exact: true }).focus();
        await page.keyboard.press("ArrowRight");
        await page.getByRole("tabpanel").filter({ hasText: "Detail body" }).waitFor();
        expect(await page.getByRole("tab", { name: "Details", exact: true }).getAttribute("aria-selected")).toBe("true");
        const inactive = page.getByRole("combobox", { name: "Unavailable provider" });
        const box = await inactive.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        expect(await page.getByRole("listbox").count()).toBe(0);
        const select = page.getByRole("combobox", { name: "Choose provider" });
        await select.focus();
        await page.keyboard.press("ArrowDown");
        await page.getByRole("option", { name: "Codex" }).click();
        expect(await select.textContent()).toContain("Codex");
        expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
        expect(await page.getByRole("img", { name: "Codex CLI" }).count()).toBe(1);
      });
    });
  }
  it("Chromium forced colours: selection has a Highlight border distinct from CanvasText focus", async () => {
    await pageFor("chromium", true, async (page) => {
      const tokens = page.getByRole("radio", { name: "Tokens" });
      await tokens.focus();
      await page.keyboard.press("ArrowRight");
      const cost = page.getByRole("radio", { name: "Cost (Est.)" });
      const styles = await cost.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "Highlight";
        document.body.appendChild(probe);
        const highlight = getComputedStyle(probe).color;
        probe.style.color = "CanvasText";
        const canvasText = getComputedStyle(probe).color;
        probe.remove();
        const cs = getComputedStyle(el);
        return { border: cs.borderTopColor, width: cs.borderTopWidth, outline: cs.outlineColor, outlineWidth: cs.outlineWidth, highlight, canvasText };
      });
      expect(styles.border).toBe(styles.highlight);
      expect(styles.width).toBe("1px");
      expect(styles.outline).toBe(styles.canvasText);
      expect(styles.outlineWidth).toBe("2px");
    });
  });
});
