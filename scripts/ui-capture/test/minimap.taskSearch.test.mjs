// Actual parser/grouping/search/virtualizer/canvas regression for PR #652.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium, webkit } from "playwright";
import { browserRequirement, SERVER_BIN } from "./requirements.mjs";
import { generateFixture } from "../fixtures/generate.mjs";
import { startServer } from "../lib/server.mjs";
import { newScenarioPage, settle } from "../lib/browser.mjs";
import { createActions } from "../lib/actions.mjs";
import { loadTranslator } from "../lib/i18n.mjs";
import { STORAGE_SEED } from "../scenarios.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENABLED = browserRequirement({ webkit: true, chromium: true, server: true }, { label: "minimap.taskSearch" }).enabled;

/** Six raw Claude records become four product messages after result merging. */
function fixture(engine) {
  const root = path.join(REPO, "scratch", `minimap-task-search-${engine}`);
  const manifest = generateFixture({ root });
  const file = manifest.largeSession.filePath;
  const original = fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
  const entries = [];
  const add = (uuid, type, content, toolUseResult) => {
    const template = type === "assistant" ? original.at(-1) : original[0];
    entries.push({ ...template, uuid, parentUuid: entries.at(-1)?.uuid ?? null,
      timestamp: `2026-06-29T22:01:0${entries.length}.000Z`, type,
      message: { ...template.message, role: type, content },
      ...(toolUseResult ? { toolUseResult } : {}),
    });
  };
  add("review-user", "user", original[0].message.content);
  add("review-leader", "assistant", [{ type: "tool_use", id: "create", name: "TaskCreate", input: { subject: "Review group leader", description: "First operation in a grouped task", activeForm: "Creating a task" } }]);
  add("result-create", "user", [{ type: "tool_result", tool_use_id: "create", content: "Created task 1" }], { task: { id: "1", subject: "Review group leader", status: "pending" } });
  add("review-member", "assistant", [{ type: "tool_use", id: "update", name: "TaskUpdate", input: { taskId: "1", status: "completed", description: "pr652HiddenTaskNeedle" } }]);
  add("result-update", "user", [{ type: "tool_result", tool_use_id: "update", content: "pr652HiddenTaskNeedle" }], { success: true, taskId: "1", statusChange: { from: "pending", to: "completed" } });
  add("review-tail", "assistant", [{ type: "text", text: "Task finished. This is the visible row after the group." }]);
  fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  fs.rmSync(path.join(path.dirname(file), ".session_cache.json"), { force: true });
  return { root, manifest };
}

describe.skipIf(!ENABLED)("hidden Task Operations search ticks (real browsers)", () => {
  it.each(["webkit", "chromium"])("%s: hidden TaskUpdate paints at the visible leader, not the following reply", async engine => {
    const { root, manifest } = fixture(engine);
    const server = await startServer({ binary: SERVER_BIN,
      dist: process.env.UI_TEST_DIST ?? path.join(REPO, ".ui-capture/build/dist"),
      home: manifest.home, fixtureRoot: root, logFile: path.join(root, "server.log"),
    });
    const browser = await (engine === "webkit" ? webkit : chromium).launch();
    let session;
    try {
      const scenario = { id: "task-group-search", viewport: { width: 1440, height: 900 }, theme: "dark", mobile: false };
      session = await newScenarioPage(browser, { scenario, origin: server.origin, locale: "en", fixedNow: manifest.fixedNow, injections: [], storageSeed: { ...STORAGE_SEED, "minimap-open": "true" } });
      const { page } = session;
      const act = createActions({ session, scenario, manifest, t: loadTranslator(REPO, "en") });
      await page.goto(server.origin);
      await settle(session);
      await act({ do: "openSession", session: "large" });
      await settle(session);
      await act({ do: "transcriptSearch", query: "pr652HiddenTaskNeedle" });
      await settle(session);
      const strip = page.locator('div[aria-hidden="true"]:has(> canvas)').first();
      expect(await strip.count()).toBe(1);
      // Read actual mounted minimap props only to identify its real scroll
      // viewport and virtual measurements; do not substitute a test resolver.
      const observed = await strip.evaluate(el => {
        let fiber = el[Object.keys(el).find(key => key.startsWith("__reactFiber"))];
        while (fiber && !fiber.memoizedProps?.flattenedMessages) fiber = fiber.return;
        if (!fiber) throw new Error("No mounted SessionMinimap props");
        const props = fiber.memoizedProps;
        const vp = props.getScrollElement();
        const row = vp.querySelector("[data-index]");
        const offset = row.parentElement.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop - (props.virtualizer.options.scrollMargin ?? 0);
        const scale = el.clientHeight / vp.scrollHeight;
        const rows = props.flattenedMessages.flatMap((item, index) => {
          if (item.type !== "message") return [];
          const dom = vp.querySelector(`[data-index="${index}"]`);
          const measurement = props.virtualizer.measurementsCache[index];
          return [{ uuid: item.message.uuid, index, member: item.isTaskOperationGroupMember,
            height: dom?.getBoundingClientRect().height, hidden: dom?.getAttribute("aria-hidden"),
            start: measurement.start, size: measurement.size,
            resolves: props.getScrollIndex(item.message.uuid),
            tick: Math.floor((measurement.start + offset) * scale) }];
        });
        const canvas = el.querySelector("canvas"), dpr = canvas.width / el.clientWidth;
        const image = canvas.getContext("2d").getImageData(Math.floor((el.clientWidth - 7) * dpr), 0, Math.ceil(7 * dpr), canvas.height);
        const ys = [];
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            if (image.data[(y * image.width + x) * 4 + 3] > 0) { ys.push(y / dpr); break; }
          }
        }
        return { matched: [...props.matchedUuids], current: props.currentMatchUuid, rows, ys };
      });
      console.log(engine, JSON.stringify(observed));
      if (process.env.UI_MINIMAP_SHOTS_DIR) {
        fs.mkdirSync(process.env.UI_MINIMAP_SHOTS_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.UI_MINIMAP_SHOTS_DIR, `task-group-${engine}.png`), animations: "disabled" });
      }
      const leader = observed.rows.find(row => row.uuid === "review-leader");
      const member = observed.rows.find(row => row.uuid === "review-member");
      const tail = observed.rows.find(row => row.uuid === "review-tail");
      expect(observed.matched).toEqual(["review-member"]);
      expect(observed.current).toBe("review-member");
      expect(leader.height).toBeGreaterThan(50);
      expect(member).toMatchObject({ member: true, height: 0, size: 0, hidden: "true" });
      expect(member.start).toBe(tail.start);
      expect(member.start).toBeGreaterThan(leader.start + 50);
      expect(observed.ys.length).toBeGreaterThan(0);
      expect(Math.abs(Math.min(...observed.ys) - leader.tick), JSON.stringify(observed)).toBeLessThanOrEqual(2);
      expect(member.resolves).toBe(leader.index);
      expect(session.log.pageErrors).toEqual([]);
    } finally {
      await session?.close();
      await browser.close();
      await server.stop();
    }
  }, 120_000);
});
