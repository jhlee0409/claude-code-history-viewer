// The current search mark in a tool row's head is visible on the
// current-match message (#736).
//
// A current-match message is painted `--highlight-current`, the current
// mark's own background, and the mark's text colour is about the row's own,
// so in a row head (no surface of its own) the mark used to be invisible:
// the same pixel (115,91,0 in dark) inside and outside it. The current mark
// now carries an underline in its text colour.
//
// Real WebKit, the real server, a raw Claude record: a NotebookEdit call
// planted into the generated "unknown-outcome" session (fixture copy owned by
// this file), searched for the notebook's name, which the row head shows as
// its target. The name has no descenders, so the underline is not broken by
// skip-ink. Per theme, in the captured pixels: a row under the mark's glyphs
// where nearly every pixel across the mark is its underline colour (drawn
// in full, not clipped by the row head), and that colour is ≥3:1
// against the message background next to the mark (WCAG 1.4.11).
// Before the fix (UI_TEST_DIST=<base dist>) no such row exists. Skipped
// without WebKit or a built server.

import fs from "node:fs";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { createActions } from "../lib/actions.mjs";
import { channelDelta, contrastSrgb8 } from "../../tokens/color.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "searchMarkCurrent.test" }).enabled;

const THEMES = ["dark", "light"];
const QUERY = "canvas";
const CALL = { type: "tool_use", id: "toolu_mark_head", name: "NotebookEdit", input: { notebook_path: "/work/notebooks/canvas.ipynb", new_source: "x=1" } };

let app;
let browser;

/** The unknown-outcome session becomes: the user's question, one NotebookEdit call, its result. */
function plantCall(fixture) {
  const project = fixture.projects.find((p) => p.name === "kiln-renderers");
  const session = project.sessions.find((s) => s.title === fixture.namedSessions["unknown-outcome"].title);
  const old = fs
    .readFileSync(session.filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const question = old.find((r) => r.type === "user" && typeof r.message?.content === "string");
  const assistant = structuredClone(old.find((r) => r.type === "assistant" && r.message.content.some((b) => b.type === "tool_use")));
  const resultTemplate = old.find((r) => r.type === "user" && Object.hasOwn(r, "toolUseResult"));
  assistant.message.content = [{ type: "text", text: "Editing the notebook." }, CALL];
  const result = {
    ...structuredClone(resultTemplate),
    uuid: "mark-head-result",
    parentUuid: assistant.uuid,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: CALL.id, content: "Done." }] },
  };
  delete result.toolUseResult;
  fs.writeFileSync(session.filePath, [question, assistant, result].map((r) => JSON.stringify(r)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("search-mark-current");
  plantCall(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

describe.skipIf(!ENABLED)("the current search mark in a tool row head stands out from the current-match message (real WebKit)", () => {
  it.each(THEMES)("%s theme", async (theme) => {
    const id = `transcript-unknown-outcome--1440x900--${theme}`;
    const session = await openScenario(browser, app, id, { locale: "en" });
    try {
      const run = createActions({ session, scenario: expandScenarios().find((s) => s.id === id), manifest: app.fixture, t: session.t });
      await run({ do: "transcriptSearch", query: QUERY });
      const mark = session.page.locator('[data-tool-row] mark[aria-current="true"]');
      expect(await mark.count(), "the current mark is in the row head").toBe(1);
      const box = await mark.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const message = el.closest("[data-message-uuid]");
        return {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          padLeft: parseFloat(cs.paddingLeft),
          padRight: parseFloat(cs.paddingRight),
          messageIsCurrent: message?.className.includes("bg-highlight-current") ?? false,
        };
      });
      expect(box.messageIsCurrent, "the mark's message is the current match").toBe(true);
      // The mark's box and 6px below it (an underline may sit under the box).
      const clip = { x: Math.floor(box.x) - 4, y: Math.floor(box.y), width: Math.ceil(box.width) + 8, height: Math.ceil(box.height) + 6 };
      const shot = PNG.sync.read(await session.page.screenshot({ clip, animations: "disabled" }));
      const scale = shot.width / clip.width;
      const px = (x, y) => {
        const i = (y * shot.width + x) * 4;
        return [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
      };
      // The message background: the column just left of the mark, at mid-height.
      const background = px(Math.round(1 * scale), Math.round((box.height / 2) * scale));
      // Across the mark's text (inside its padding, 1px in from each side).
      const from = Math.ceil((4 + box.padLeft + 1) * scale);
      const to = Math.floor((4 + box.width - box.padRight - 1) * scale);
      const near = (a, b) => channelDelta(a, b) <= 24;
      let best = { share: 0, contrast: 0, y: -1 };
      for (let y = 0; y < shot.height; y += 1) {
        // The row's dominant colour that differs from the background.
        const counts = new Map();
        for (let x = from; x < to; x += 1) {
          const c = px(x, y);
          if (near(c, background)) continue;
          const key = c.join(",");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        if (!top) continue;
        const color = top[0].split(",").map(Number);
        let share = 0;
        for (let x = from; x < to; x += 1) if (near(px(x, y), color)) share += 1;
        share /= to - from;
        if (share > best.share) best = { share, contrast: contrastSrgb8(color, background), y };
      }
      const where = `${theme}: background ${background}, best row ${JSON.stringify(best)}`;
      expect(best.share, `an unclipped underline runs across the mark — ${where}`).toBeGreaterThanOrEqual(0.9);
      expect(best.contrast, `the underline is ≥3:1 against the message background — ${where}`).toBeGreaterThanOrEqual(3);
      expect(session.log.pageErrors, "no uncaught page error").toEqual([]);
    } finally {
      await session.close();
    }
  }, 120_000);
});
