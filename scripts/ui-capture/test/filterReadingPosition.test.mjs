import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { chromium, webkit } from "playwright";
import { REPO, startApp } from "./appSession.mjs";
import { browserRequirement } from "./requirements.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { STORAGE_SEED } from "../scenarios.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator } from "../lib/i18n.mjs";

const enabled = browserRequirement({ chromium: true, webkit: true, server: true }, { label: "filterReadingPosition" }).enabled;
// Observe the real external-store getter, without replacing store data or actions.
function observeStore() {
  window.__filterRead = {};
  const hook = { supportsFiber: true, renderers: new Map(), inject(r) { this.renderers.set(1, r); return 1; }, onCommitFiberUnmount() {}, onCommitFiberRoot(_id, root) {
    if (window.__filterRead.state) return;
    const stack = [root.current];
    while (stack.length) {
      const f = stack.pop();
      for (let h = f.memoizedState, n = 0; h && n < 100; h = h.next, n++) {
        const getter = h.queue?.getSnapshot;
        if (typeof getter === "function") {
          const s = getter();
          if (s && Array.isArray(s.messages) && typeof s.selectSession === "function") window.__filterRead.state = getter;
        }
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
  } };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook });
}
function snapshot() {
  const s = window.__filterRead.state();
  const vp = document.querySelector("[data-message-uuid]")?.closest("[data-overlayscrollbars-viewport]");
  const bounds = vp?.getBoundingClientRect();
  return { ids: s.messages.map(m => m.uuid), selected: s.selectedSession?.file_path, target: s.targetMessageUuid, show: s.showSystemMessages,
    scrollTop: vp?.scrollTop, height: vp?.clientHeight, total: vp?.scrollHeight,
    rows: vp ? [...vp.querySelectorAll("[data-message-uuid]")].map(el => ({ uuid: el.dataset.messageUuid, top: el.getBoundingClientRect().top - bounds.top, bottom: el.getBoundingClientRect().bottom - bounds.top })).filter(r => r.bottom > 0 && r.top < vp.clientHeight) : [] };
}

describe.skipIf(!enabled)("filter reading position through real HTTP and measured virtual rows", () => {
  it.each(["webkit", "chromium"])("%s: show/hide system records retains the same visible source and offset", async engine => {
    const app = await startApp(`filter-position-${engine}`);
    const codex = path.join(app.fixture.home, ".codex/sessions/2026/01/01/rollout-public-preservation.jsonl");
    fs.mkdirSync(path.dirname(codex), { recursive: true });
    fs.copyFileSync(path.join(REPO, "src-tauri/tests/fixtures/codex-preservation.jsonl"), codex);
    const browser = await ({ webkit, chromium }[engine]).launch();
    let session;
    const receipt = { engine, dist: app.dist };
    try {
      const scenario = { id: "filter-position", viewport: { width: 1440, height: 900 }, theme: "dark", mobile: false };
      session = await newScenarioPage(browser, { scenario, origin: app.server.origin, locale: "en", fixedNow: app.fixture.fixedNow, storageSeed: STORAGE_SEED, variant: { live: true } });
      await session.context.addInitScript(observeStore);
      const p = session.page;
      await p.goto(app.server.origin); await settle(session);
      await p.waitForFunction(() => !!window.__filterRead.state);
      await p.evaluate(async () => {
        const state = window.__filterRead.state();
        const project = state.projects.find(p => p.provider === "codex");
        if (!project) throw Error("real scanner Codex project missing");
        await state.selectProject(project);
        const selected = window.__filterRead.state().sessions.find(s => s.provider === "codex");
        if (!selected) throw Error("real scanner Codex session missing");
        await window.__filterRead.state().navigate({ session: selected });
      });
      await settle(session);
      const before = receipt.before = await p.evaluate(snapshot);
      expect(before.ids).toHaveLength(8);
      expect(before.target).toBeNull();
      // This fixture opens at the tail: the last visible source is the
      // currently read tail row (not a clipped earlier tool result).
      const anchor = before.rows.at(-1);
      expect(anchor, "positive visible source before filtering").toBeTruthy();
      for (const [name, show, count] of [["shown", true, 11], ["hidden", false, 8]]) {
        await p.locator("#app-settings-button").click();
        await p.getByRole("menuitemcheckbox", { name: loadTranslator(REPO, "en")("common.settings.filter.showSystemMessages") }).click();
        await p.waitForFunction(({ show, count }) => { const s = window.__filterRead.state(); return s.showSystemMessages === show && s.messages.length === count && !s.isLoadingMessages; }, { show, count });
        await p.keyboard.press("Escape"); await settle(session);
        const after = receipt[name] = await p.evaluate(snapshot);
        expect(after.selected).toBe(before.selected);
        expect(after.target).toBeNull();
        expect(after.ids).toContain(anchor.uuid);
        const retained = after.rows.find(r => r.uuid === anchor.uuid);
        expect(retained, "original source stays visible without corrective navigation").toBeTruthy();
        receipt[name + "Delta"] = retained.top - anchor.top;
        expect(Math.abs(retained.top - anchor.top), `${name}: source UUID + measured viewport offset`).toBeLessThanOrEqual(2);
      }
      expect(receipt.hidden.ids).toEqual(before.ids);
      expect(session.log.pageErrors).toEqual([]);
    } finally {
      console.log("FILTER_READING_RECEIPT", JSON.stringify(receipt));
      if (process.env.FILTER_POSITION_OUT) { fs.mkdirSync(process.env.FILTER_POSITION_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.FILTER_POSITION_OUT, engine + ".json"), JSON.stringify(receipt, null, 2)); if (session) await session.page.screenshot({ path: path.join(process.env.FILTER_POSITION_OUT, engine + ".png") }); }
      await session?.close(); await browser.close(); await app.stop();
    }
  }, 120000);

  it.each(["webkit", "chromium"])("%s: role filtering retains an up-reading source; a hidden source does not fetch or become a target", async engine => {
    const app = await startApp(`filter-role-${engine}`);
    const templates = fs.readFileSync(app.fixture.largeSession.filePath, "utf8").trim().split("\n").map(JSON.parse);
    const user = templates.find(r => r.type === "user" && typeof r.message.content === "string");
    const assistant = templates.find(r => r.type === "assistant" && r.message.content.some?.(b => b.type === "text"));
    const records = Array.from({ length: 440 }, (_, i) => {
      const type = i % 2 ? "assistant" : "user", template = type === "user" ? user : assistant;
      return { ...template, uuid: `position-${i}`, parentUuid: i ? `position-${i - 1}` : null, timestamp: new Date(Date.parse(app.fixture.fixedNow) - 1000000 + i * 1000).toISOString(), type,
        message: { ...template.message, id: `position-message-${i}`, role: type, content: type === "user" ? (i === 0 ? user.message.content : `Reading source ${i} ` + "body ".repeat(30)) : [{ type: "text", text: `Reading response ${i} ` + "body ".repeat(30) }] } };
    });
    fs.writeFileSync(app.fixture.largeSession.filePath, records.map(JSON.stringify).join("\n") + "\n");
    const browser = await ({ webkit, chromium }[engine]).launch();
    let session;
    const receipt = { engine, dist: app.dist };
    try {
      const scenario = { id: "role-position", viewport: { width: 1440, height: 900 }, theme: "dark", mobile: false };
      session = await newScenarioPage(browser, { scenario, origin: app.server.origin, locale: "en", fixedNow: app.fixture.fixedNow, storageSeed: STORAGE_SEED, variant: { live: true } });
      await session.context.addInitScript(observeStore);
      const p = session.page;
      await p.goto(app.server.origin); await settle(session);
      const act = createActions({ session, scenario, manifest: app.fixture, t: loadTranslator(REPO, "en") });
      await act({ do: "openSession", session: "large" }); await settle(session);
      await p.evaluate(async () => { const read = window.__filterRead.state; while (read().pagination.hasMore) await read().loadMoreMessages(); });
      await settle(session);
      // Product navigation establishes a measured row, then returns to ordinary reading.
      await p.evaluate(() => window.__filterRead.state().navigateToMessage("position-340")); await settle(session);
      await p.evaluate(() => window.__filterRead.state().clearTargetMessage()); await settle(session);
      await p.evaluate(() => { const row = document.querySelector('[data-message-uuid="position-340"]'); const vp = row.closest("[data-overlayscrollbars-viewport]"); vp.scrollTop += row.getBoundingClientRect().top - vp.getBoundingClientRect().top + 12; });
      await settle(session);
      const before = receipt.before = await p.evaluate(snapshot);
      const anchor = before.rows[0];
      expect(anchor.uuid).toBe("position-340");
      for (const name of ["filtered", "revealed"]) {
        await p.evaluate(() => window.__filterRead.state().toggleRole("assistant")); await settle(session);
        const after = receipt[name] = await p.evaluate(snapshot);
        const retained = after.rows.find(r => r.uuid === anchor.uuid);
        expect(retained, "up-reading source remains visible").toBeTruthy();
        expect(Math.abs(retained.top - anchor.top)).toBeLessThanOrEqual(2);
        expect(after.target).toBeNull();
        expect(after.total - after.scrollTop - after.height).toBeGreaterThan(100);
      }
      // When the anchor itself is hidden, preserve the existing unavailable
      // behavior: no ensure-load, no invented target, and no filter reversal.
      let olderRequests = 0;
      p.on("request", req => { if (req.url().includes("load_provider_messages_paginated")) olderRequests++; });
      await p.evaluate(() => window.__filterRead.state().toggleRole("user")); await settle(session);
      receipt.hidden = await p.evaluate(snapshot);
      expect(receipt.hidden.rows.some(r => r.uuid === anchor.uuid)).toBe(false);
      expect(receipt.hidden.target).toBeNull();
      expect(olderRequests).toBe(0);
      expect(await p.evaluate(() => window.__filterRead.state().messageFilter.roles.user)).toBe(false);
      expect(session.log.pageErrors).toEqual([]);
    } finally {
      console.log("ROLE_READING_RECEIPT", JSON.stringify(receipt));
      if (process.env.FILTER_POSITION_OUT) fs.writeFileSync(path.join(process.env.FILTER_POSITION_OUT, engine + "-role.json"), JSON.stringify(receipt, null, 2));
      await session?.close(); await browser.close(); await app.stop();
    }
  }, 120000);
});
