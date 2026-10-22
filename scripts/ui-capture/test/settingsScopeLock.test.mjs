// Real API -> real scope-line component. Managed scope has no selector in the
// existing app; this bounded renderer verifies its policy, not app reachability.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { generateFixture } from "../fixtures/generate.mjs";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { loadTranslator, SUPPORTED_LOCALES } from "../lib/i18n.mjs";
/* global document, window, getComputedStyle */
const repo = process.cwd(), binary = path.resolve(".ui-capture/build/cchv-server");
const enabled = fs.existsSync(binary) && fs.existsSync(webkit.executablePath());
if (!enabled && process.env.CI_REQUIRE_BROWSER === "1") throw new Error("Managed scope renderer requires server and WebKit");
const root = path.resolve(`.ui-capture/settings-scope-lock-${process.pid}`);
let server, browser, fixture;
const reports = [];
beforeAll(async () => {
  if (!enabled) return;
  fs.mkdirSync(root, { recursive: true });
  fixture = generateFixture({ root: path.join(root, "fixture") });
  fs.writeFileSync(path.join(root, "index.html"), '<html class="dark"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  fs.writeFileSync(path.join(root, "fixture.css"), `@import "${repo}/src/index.css";\n@source "${repo}/src/components/SettingsManager/SettingsScopeLine.tsx";\n@source "${repo}/src/lib/format/PathText.tsx";`);
  fs.writeFileSync(path.join(root, "entry.tsx"), `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import i18n from "${repo}/src/i18n";
    import { SettingsScopeLine } from "${repo}/src/components/SettingsManager/SettingsScopeLine";
    import "./fixture.css";
    const params = new URLSearchParams(location.search);
    await i18n.changeLanguage(params.get("locale") || "en");
    document.documentElement.lang = i18n.language;
    const result = await fetch("/api/get_all_settings", {method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    if (!result.ok) throw new Error("Settings API failed");
    const settings = await result.json();
    window.__settingsScopeRecord = settings;
    createRoot(document.getElementById("root")!).render(<div className="p-4 bg-background text-foreground"><SettingsScopeLine allSettings={settings} scope="managed" dirty={false} readOnly={true}/></div>);
  `);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === "NODE_ENV" || key.startsWith("VITEST")) delete env[key];
  const built = spawnSync(process.execPath, [path.join(repo, "node_modules/vite/bin/vite.js"), "build", root, "--config", path.join(repo, "vite.config.ts"), "--outDir", path.join(root, "dist"), "--logLevel", "error"], { cwd: repo, env, encoding: "utf8" });
  expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
  server = await startServer({ binary, dist: path.join(root, "dist"), home: fixture.home, fixtureRoot: root, logFile: path.join(root, "server.log") });
  browser = await webkit.launch();
}, 120_000);
afterAll(async () => {
  if (process.env.UI_SETTINGS_LOCK_REPORT) fs.writeFileSync(process.env.UI_SETTINGS_LOCK_REPORT, JSON.stringify(reports, null, 2));
  await browser?.close(); await server?.stop();
  if (enabled) fs.rmSync(root, { recursive: true, force: true });
});
describe.skipIf(!enabled)("managed policy from actual metadata in the real component at 390px/125%", () => {
  it.each(SUPPORTED_LOCALES)("%s: read-only explanation, exact path or unsupported, no save promise", async locale => {
    const session = await newScenarioPage(browser, { scenario: { viewport: { width: 390, height: 844 }, theme: "dark", mobile: true }, origin: server.origin, locale, fixedNow: fixture.fixedNow, variant: { fontScale: 1.25 } });
    try {
      await session.page.goto(`${server.origin}/?locale=${locale}`);
      await session.page.getByTestId("settings-scope-line").waitFor(); await settle(session);
      const t = loadTranslator(repo, locale), header = session.page.getByTestId("settings-scope-line");
      const actual = await session.page.evaluate(() => window.__settingsScopeRecord.metadata.scopes.managed);
      expect(actual.readOnly).toBe(true);
      expect(await header.innerText()).toContain(t("settingsManager.writeScope.readOnly"));
      expect(await header.innerText()).toContain(t("settingsManager.writeScope.noWrite"));
      expect(await header.innerText()).not.toContain(t("settingsManager.writeScope.saveTarget"));
      if (actual.path) {
        expect(await header.locator("[data-path]").getAttribute("data-path")).toBe(actual.path);
        expect(await header.locator("[data-path]").getAttribute("title")).toBe(actual.path);
        expect(await header.locator("[data-path]").getAttribute("data-path-kind")).toBe("absolute");
        expect(await header.locator('[data-path-part="dir"]').evaluate(element => getComputedStyle(element).overflow)).toBe("hidden");
        expect(await header.locator('[data-path-part="name"]').innerText()).toBe("managed-settings.json");
      } else expect(await header.locator("[data-path]").count()).toBe(0);
      const geometry = await header.evaluate(element => {
        const box = element.getBoundingClientRect();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const rects = [];
        while (walker.nextNode()) {
          const text = walker.currentNode;
          // PathText deliberately ellipsises only directories; its full path
          // remains in data-path/title. Measure every other visible glyph.
          if (text.parentElement?.closest('[data-path-part="dir"]')) continue;
          const range = document.createRange(); range.selectNodeContents(text);
          rects.push(...range.getClientRects());
        }
        return { width: window.innerWidth, rootFont: getComputedStyle(document.documentElement).fontSize, overflow: document.documentElement.scrollWidth - window.innerWidth,
          glyphsOutside: rects.filter(rect => rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1)).length };
      });
      expect(geometry).toEqual({ width: 390, rootFont: "20px", overflow: 0, glyphsOutside: 0 });
      expect(session.log.pageErrors).toEqual([]);
      if (process.env.UI_SETTINGS_LOCK_REPORT) await session.page.screenshot({ path: path.join(path.dirname(process.env.UI_SETTINGS_LOCK_REPORT), `${locale}-managed.png`) });
      reports.push({ locale, actual, ...geometry });
    } finally { await session.context.close(); }
  }, 30_000);
});
