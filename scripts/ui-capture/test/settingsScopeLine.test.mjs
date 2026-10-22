// Isolated HOME -> real HTTP -> real editor, including JSON text before blur.
// Only the legacy-response case removes metadata at the transport boundary.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { generateFixture } from "../fixtures/generate.mjs";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator, SUPPORTED_LOCALES } from "../lib/i18n.mjs";
import { STORAGE_SEED, expandScenarios } from "../scenarios.mjs";
/* global document, window, getComputedStyle */
const binary = path.resolve(".ui-capture/build/cchv-server");
const dist = process.env.UI_TEST_DIST ?? path.resolve(".ui-capture/build/dist");
const enabled = fs.existsSync(binary) && fs.existsSync(path.join(dist, "index.html")) && fs.existsSync(webkit.executablePath());
if (!enabled && process.env.CI_REQUIRE_BROWSER === "1") throw new Error("Settings write-scope requires server, dist and WebKit");
const root = path.resolve(`.ui-capture/settings-scope-fixture-${process.pid}`);
const evidence = process.env.UI_SETTINGS_SCOPE_REPORT ? path.dirname(path.resolve(process.env.UI_SETTINGS_SCOPE_REPORT)) : null;
let fixture, server, browser;
const reports = [];
const scenarios = new Map(expandScenarios().map(item => [item.id, item]));
beforeAll(async () => {
  if (!enabled) return;
  fixture = generateFixture({ root });
  server = await startServer({ binary, dist, home: fixture.home, fixtureRoot: root, logFile: path.join(root, "server.log") });
  browser = await webkit.launch();
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
});
afterAll(async () => {
  if (process.env.UI_SETTINGS_SCOPE_REPORT) fs.writeFileSync(process.env.UI_SETTINGS_SCOPE_REPORT, JSON.stringify(reports, null, 2));
  await browser?.close();
  await server?.stop();
  if (enabled) fs.rmSync(root, { recursive: true, force: true });
});
async function open(locale = "en", { legacy = false, onLoading } = {}) {
  const scenario = scenarios.get("settings--390x844--dark");
  const session = await newScenarioPage(browser, { scenario, origin: server.origin, locale, fixedNow: fixture.fixedNow, storageSeed: STORAGE_SEED, variant: { fontScale: 1.25 } });
  if (onLoading) await session.context.route(`${server.origin}/api/get_all_settings`, async route => {
    // Hold the real response; never manufacture a header state.
    const response = await route.fetch();
    await onLoading({ ...session, t: loadTranslator(process.cwd(), locale) });
    await route.fulfill({ response });
  });
  if (legacy) await session.context.route(`${server.origin}/api/get_all_settings`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.metadata;
    await route.fulfill({ response, json: body });
  });
  await session.page.goto(`${server.origin}/`);
  await settle(session);
  const t = loadTranslator(process.cwd(), locale);
  const run = createActions({ session, scenario, manifest: fixture, t });
  for (const step of scenario.screen.steps) await run(step);
  await settle(session);
  return { ...session, t, run };
}
async function apiMetadata(projectPath) {
  const response = await fetch(`${server.origin}/api/get_all_settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectPath }) });
  expect(response.status).toBe(200);
  return response.json();
}
async function inspect(session, name) {
  const { page, log } = session;
  await page.getByTestId("settings-scope-line").scrollIntoViewIfNeeded();
  const geometry = await page.getByTestId("settings-scope-line").evaluate(element => {
    const box = element.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(element);
    return { width: window.innerWidth, rootFont: getComputedStyle(document.documentElement).fontSize,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      glyphsOutside: [...range.getClientRects()].filter(rect => rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1)).length,
      path: element.querySelector("[data-path]")?.getAttribute("data-path"), text: element.textContent };
  });
  expect(geometry.width).toBe(390);
  expect(geometry.rootFont).toBe("20px");
  expect(geometry.overflow).toBeLessThanOrEqual(0);
  expect(geometry.glyphsOutside).toBe(0);
  expect(log.pageErrors).toEqual([]);
  if (evidence) await page.screenshot({ path: path.join(evidence, `${name}.png`) });
  reports.push({ name, ...geometry });
}
describe.skipIf(!enabled)("settings write scope in real WebKit at 390px / 125%", () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: user -> project inheritance -> local, dirty JSON -> undo -> reset`, async () => {
      let observedLoading = 0;
      const session = await open(locale, { onLoading: async pending => {
        observedLoading += 1;
        const header = pending.page.getByTestId("settings-scope-line");
        await header.waitFor();
        expect(await header.innerText()).toContain(pending.t("settingsManager.writeScope.loading"));
        expect(await header.locator("[data-path]").count()).toBe(0);
        await inspect(pending, `${locale}-loading`);
      } });
      const { page, t, run } = session;
      try {
        const header = page.getByTestId("settings-scope-line");
        expect(observedLoading).toBeGreaterThan(0);
        await session.context.unroute(`${server.origin}/api/get_all_settings`);
        const actual = await apiMetadata();
        expect(await header.locator("[data-path]").getAttribute("data-path")).toBe(actual.metadata.scopes.user.path);
        expect(await header.locator("[data-path]").getAttribute("data-path-kind")).toBe("home");
        await inspect(session, `${locale}-user`);
        await run({ do: "settingsProject", project: "featured" });
        const selected = await page.getByRole("combobox", { name: t("settingsManager.context.selectProject"), exact: true }).innerText();
        const project = fixture.projects.find(project => selected.includes(project.name));
        expect(project).toBeTruthy();
        const resolved = await apiMetadata(project.cwd);
        expect(await header.locator("[data-path]").getAttribute("data-path")).toBe(resolved.metadata.scopes.project.path);
        expect(await header.innerText()).toContain(t("settingsManager.scope.user"));
        await inspect(session, `${locale}-inherited`);
        await page.locator("#private-toggle").click(); await settle(session);
        expect(await header.locator("[data-path]").getAttribute("data-path")).toBe(resolved.metadata.scopes.local.path);
        await inspect(session, `${locale}-local`);
        await page.getByRole("button", { name: t("settingsManager.mode.json"), exact: true }).click();
        const editor = page.getByRole("textbox", { name: t("settingsManager.mode.json"), exact: true });
        await editor.fill('{"model":');
        // Do not scroll back to the header: the write scope must remain visible
        // at the actual editing position, not only when a screenshot asks for it.
        const scopeBox = await header.boundingBox();
        expect(scopeBox.y, "write-scope line scrolled out while editing").toBeGreaterThanOrEqual(0);
        expect(scopeBox.y + scopeBox.height).toBeLessThanOrEqual(844);
        expect(await header.innerText()).toContain(t("settingsManager.writeScope.dirty"));
        expect(await page.getByRole("button", { name: t("settingsManager.unified.footer.save"), exact: true }).isDisabled()).toBe(true);
        await inspect(session, `${locale}-json-invalid-dirty`);
        await page.getByRole("button", { name: t("settingsManager.json.undo"), exact: true }).click();
        expect(await header.innerText()).toContain(t("settingsManager.writeScope.clean"));
        await editor.fill('{"model":"opus"}');
        expect(await header.innerText()).toContain(t("settingsManager.writeScope.dirty"));
        await page.getByRole("button", { name: t("settingsManager.unified.footer.reset"), exact: true }).click();
        expect(await header.innerText()).toContain(t("settingsManager.writeScope.clean"));
      } finally { await session.context.close(); }
    }, 90_000);
  }

  it.each(SUPPORTED_LOCALES)("%s: sticky scope line never covers the focused control", async locale => {
    const session = await open(locale);
    const { page, run } = session;
    try {
      await run({ do: "settingsToggle" });
      const header = page.getByTestId("settings-scope-line");
      const input = page.locator("main").last().getByRole("textbox").first();
      const measureFocus = () => page.evaluate(() => {
        const scope = document.querySelector('[data-testid="settings-scope-line"]').getBoundingClientRect();
        const active = document.activeElement, field = active.getBoundingClientRect();
        const hit = document.elementFromPoint(field.x + field.width / 2, field.y + field.height / 2);
        return { tag: active.tagName, scope: { top: scope.top, bottom: scope.bottom }, field: { top: field.top, bottom: field.bottom }, hit: active === hit || active.contains(hit) };
      });
      // Positive control: the same native focus is unobscured without sticky.
      await header.evaluate(element => { element.style.position = "static"; });
      await input.focus(); await settle(session);
      const control = await measureFocus();
      expect(control.field.top >= control.scope.bottom || control.field.bottom <= control.scope.top).toBe(true);
      expect(control.hit).toBe(true);
      await header.evaluate(element => { element.style.removeProperty("position"); });
      await page.getByRole("button", { name: session.t("settingsManager.mode.json"), exact: true }).focus();
      await input.focus(); await settle(session);
      const positions = [];
      for (const key of [null, "Shift+Tab", "Tab"]) {
        if (key) { await page.keyboard.press(key); await settle(session); }
        const position = await measureFocus(); positions.push({ key, ...position });
        // Native WebKit can leave the document at the first/last Tab stop.
        // Keep that attempt in the report, but it is not a focused field.
        if (["BODY", "HTML"].includes(position.tag)) continue;
        expect(position.field.top >= position.scope.bottom || position.field.bottom <= position.scope.top, JSON.stringify(position)).toBe(true);
        expect(position.hit).toBe(true);
      }
      expect(positions.some(position => position.tag === "INPUT")).toBe(true);
      await inspect(session, `${locale}-keyboard-fields`);
      reports[reports.length - 1].focusPositions = positions;
    } finally { await session.context.close(); }
  }, 60_000);

  it.each(SUPPORTED_LOCALES)("%s: native focus keeps the whole dirty-editor input inside its scroll viewport", async locale => {
    const session = await open(locale);
    try {
      await session.run({ do: "settingsToggle" });
      const input = session.page.locator("main").last().getByRole("textbox").first();
      // No static-header control or screenshot helper may reposition this path.
      await input.focus(); await settle(session);
      const position = await input.evaluate(element => {
        const field = element.getBoundingClientRect();
        const line = document.querySelector('[data-testid="settings-scope-line"]');
        const scope = line.getBoundingClientRect(), viewport = line.parentElement.getBoundingClientRect();
        return { field: { top: field.top, bottom: field.bottom }, scope: { top: scope.top, bottom: scope.bottom }, viewport: { top: viewport.top, bottom: viewport.bottom } };
      });
      expect(position.field.top, JSON.stringify(position)).toBeGreaterThanOrEqual(position.scope.bottom);
      expect(position.field.bottom, JSON.stringify(position)).toBeLessThanOrEqual(position.viewport.bottom);
      expect(position.scope.top).toBeGreaterThanOrEqual(0);
      expect(position.scope.bottom).toBeLessThanOrEqual(844);
      expect(session.log.pageErrors).toEqual([]);
    } finally { await session.context.close(); }
  }, 60_000);

  it.each(SUPPORTED_LOCALES)("%s: legacy metadata stays unconfirmed without a fabricated path", async locale => {
    const session = await open(locale, { legacy: true });
    try {
      const header = session.page.getByTestId("settings-scope-line");
      expect(await header.locator("[data-path]").count()).toBe(0);
      expect(await header.innerText()).toContain(session.t("settingsManager.writeScope.unknown"));
      await inspect(session, `${locale}-legacy-unknown`);
    } finally { await session.context.close(); }
  }, 60_000);

  it("shows an actual unreadable file separately from missing or an empty object", async () => {
    const file = path.join(fixture.home, ".claude/settings.json"), held = `${file}.read-error-held`;
    fs.renameSync(file, held); fs.mkdirSync(file);
    let session;
    try {
      session = await open();
      const actual = await apiMetadata();
      expect(actual.metadata.scopes.user.state).toBe("read_error");
      const header = session.page.getByTestId("settings-scope-line");
      expect(await header.innerText()).toContain(session.t("settingsManager.writeScope.read_error"));
      expect(await header.locator("[data-path]").getAttribute("data-path")).toBe(actual.metadata.scopes.user.path);
      expect(await header.innerText()).not.toContain(session.t("settingsManager.writeScope.saveTarget"));
      await inspect(session, "read-error");
    } finally { await session?.context.close(); fs.rmdirSync(file); fs.renameSync(held, file); }
  }, 60_000);

  it("creates a missing file on actual save and refreshes missing -> present metadata", async () => {
    const file = path.join(fixture.home, ".claude/settings.json"), held = `${file}.held`;
    fs.renameSync(file, held);
    let session;
    try {
      session = await open();
      const { page, t } = session;
      expect(await page.getByTestId("settings-scope-line").innerText()).toContain(t("settingsManager.writeScope.missing"));
      await page.getByRole("button", { name: t("settingsManager.mode.json"), exact: true }).click();
      await page.getByRole("textbox", { name: t("settingsManager.mode.json"), exact: true }).fill('{"model":"opus"}');
      await page.getByRole("button", { name: t("settingsManager.unified.footer.save"), exact: true }).click();
      await settle(session);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ model: "opus" });
      const body = await apiMetadata();
      expect(body.metadata.scopes.user.state).toBe("present");
      expect(await page.getByTestId("settings-scope-line").innerText()).toContain(t("settingsManager.writeScope.present"));
      expect(await page.getByTestId("settings-scope-line").innerText()).toContain(t("settingsManager.writeScope.clean"));
      await inspect(session, "save-created-file");
    } finally {
      await session?.context.close();
      if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.renameSync(held, file);
    }
  }, 60_000);

  it.skipIf(process.platform === "win32")("retains dirty state and original content after a real filesystem save failure", async () => {
    const directory = path.join(fixture.home, ".claude"), file = path.join(directory, "settings.json");
    const original = fs.readFileSync(file, "utf8");
    const session = await open();
    try {
      const { page, t } = session;
      await page.getByRole("button", { name: t("settingsManager.mode.json"), exact: true }).click();
      await page.getByRole("textbox", { name: t("settingsManager.mode.json"), exact: true }).fill('{"model":"opus"}');
      fs.chmodSync(directory, 0o500);
      await page.getByRole("button", { name: t("settingsManager.unified.footer.save"), exact: true }).click();
      await settle(session);
      expect(await page.getByTestId("settings-scope-line").innerText()).toContain(t("settingsManager.writeScope.dirty"));
      expect(fs.readFileSync(file, "utf8")).toBe(original);
      expect(await page.getByRole("alert").innerText()).toContain("os error");
      await inspect(session, "save-failed-dirty");
    } finally { fs.chmodSync(directory, 0o700); await session.context.close(); }
  }, 60_000);
});
