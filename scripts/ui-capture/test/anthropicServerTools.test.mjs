import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { webkit } from "playwright";
import { startApp, openScenario } from "./appSession.mjs";
import { browserRequirement } from "./requirements.mjs";
import { settle } from "../lib/browser.mjs";
import { plantServerTools } from "../fixtures/anthropicServerTools.mjs";
const enabled = browserRequirement({ webkit: true, server: true }, { label: "anthropicServerTools.test" }).enabled;
let app, browser, planted;
beforeAll(async () => { if (!enabled) return; app = await startApp("anthropic-server-tools"); planted = plantServerTools(app.fixture); browser = await webkit.launch(); }, 240000);
afterAll(async () => { await browser?.close(); await app?.stop(); });
describe.skipIf(!enabled)("Anthropic SDK shapes through raw JSONL, HTTP and production renderer", () => {
  for (const [locale, viewport, variant] of [["en", "1440x900", {}], ["ko", "390x844", { fontScale: 1.25 }]]) it(`${locale}-${viewport}`, async () => {
    const s = await openScenario(browser, app, `transcript-unknown-outcome--${viewport}--dark`, { locale, variant });
    try {
      const checks = { view: "viewneedle", create: "false", replace: "replacementneedle", error: "errorneedle", redacted: s.t("advisorToolResultRenderer.redacted"), web: s.t("webSearchRenderer.linkCount_other").replace("{{count}}", "3"), references: "referenceneedle" };
      const observations = [];
      for (const [id, expected] of Object.entries(checks)) {
        const row = s.page.locator(`[data-message-uuid="sdk-${id}"]`);
        await row.scrollIntoViewIfNeeded(); await settle(s);
        const outer = row.locator('[data-tool-row] button[aria-expanded="false"]').first();
        if (await outer.count()) { await outer.click(); await settle(s); }
        const inner = row.getByRole("button", { name: s.t("textEditorCodeExecutionToolResultRenderer.showContent"), exact: true });
        if (await inner.count() && await inner.getAttribute("aria-expanded") === "false") { await inner.click(); await settle(s); }
        if (process.env.FG3_BASE_OBSERVE && id === "references" && await row.count() === 0) {
          if (process.env.FG3_COMPARE_SHOTS) await s.page.screenshot({ path: path.join(process.env.FG3_COMPARE_SHOTS, `${locale}-${viewport}-${id}.png`) });
          observations.push({ id, text: "Baseline renderer crashed when reference object was opened", pageErrors: s.log.pageErrors });
          break;
        }
        const text = await row.innerText();
        if (process.env.FG3_COMPARE_SHOTS) {
          fs.mkdirSync(process.env.FG3_COMPARE_SHOTS, { recursive: true });
          await row.screenshot({ path: path.join(process.env.FG3_COMPARE_SHOTS, `${locale}-${viewport}-${id}.png`) });
        }
        observations.push({ id, text });
        if (!process.env.FG3_BASE_OBSERVE) {
          expect(text).toContain(expected);
          if (id === "replace") expect(await row.locator("[data-diff-old-no]").allTextContents()).toEqual(["40", ""]);
          if (id === "error") expect(await row.locator('[data-tool-verdict="failed"]').count()).toBe(1);
          if (id === "redacted") expect(text).not.toContain("opaque-secret");
        }
      }
      if (process.env.FG3_COMPARE_SHOTS) fs.writeFileSync(path.join(process.env.FG3_COMPARE_SHOTS, `${locale}-observations.json`), JSON.stringify({ dist: app.dist, rawRecords: planted.raw.length, observations, pageErrors: s.log.pageErrors }, null, 2));
      if (!process.env.FG3_BASE_OBSERVE) expect(s.log.pageErrors).toEqual([]);
    } finally { await s.close(); }
  }, 120000);
});
