// Long monospace tokens wrap inside their card in every UI language
// (inner-UI plan F1b, CJK wrapping follow-up).
//
// Real WebKit, a 390x844 phone at root font scale 125%. Korean text breaks
// with `keep-all` + `overflow-wrap: break-word`; break-word never lowers an
// element's min-content width, so it cannot shrink a flex item that holds a
// long token. Identifiers are not numbers and may break anywhere, so the
// components that show them in a flex row opt in where they render them
// (`wrap-anywhere`): the argument of a slash command (a full commit hash) and
// a Glob pattern must wrap inside the card, never run past its edge.
// The cases are added to the generated Korean session (fixture copy owned by
// this file), then their rows are opened as a user would.
// Red: the F1b build whose exception covered every `.font-mono` element
// (41ac2d22) and the break-word base layer without the component opt-in fail
// in Korean; develop fails in every language. Skipped without WebKit or a
// built server.

import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { createActions } from "../lib/actions.mjs";
import { expandScenarios } from "../scenarios.mjs";
import { browserRequirement } from "./requirements.mjs";
import { openScenario, startApp } from "./appSession.mjs";

/* global document, getComputedStyle, innerWidth */

const ENABLED = browserRequirement({ webkit: true, server: true }, { label: "cjk.longMono.test" }).enabled;

const SCENARIO_ID = "transcript-cjk--390x844--dark";
const COMMIT_HASH = "41ac2d22cac2e71a47a5050f41c90efa797cca57";
const GLOB_PATTERN = "packages/platform/services/notifications/internal/adapters/**/templates/transactional/*.tsx";

let app;
let browser;

/** The Korean session's last answer becomes a `/review <hash>` command and a Glob call. */
function addLongMonoCases(fixture) {
  const project = fixture.projects.find((p) => p.name === "kiln-renderers");
  const session = project.sessions.find((s) => s.title === fixture.namedSessions["cjk-ko"].title);
  const records = fs
    .readFileSync(session.filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  records.findLast((record) => record.type === "assistant").message.content = [
    { type: "text", text: `<command-name>/review</command-name><command-args>${COMMIT_HASH}</command-args>` },
    { type: "tool_use", id: "toolu_long_mono_glob", name: "Glob", input: { pattern: GLOB_PATTERN } },
  ];
  fs.writeFileSync(session.filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

beforeAll(async () => {
  if (!ENABLED) return;
  app = await startApp("cjk-long-mono");
  addLongMonoCases(app.fixture);
  browser = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

/**
 * Geometry of the element that shows `token` in full (a row header that
 * truncates it on purpose is skipped): its glyph lines, its box (a tool row's
 * wrapper, else the nearest bordered ancestor: the card) and whether any box between the token and that card
 * scrolls sideways. Horizontal scroll offsets are reset first so a scrolled
 * ancestor cannot hide an overflow.
 */
const tokenGeometry = (page, token) =>
  page.evaluate((token) => {
    const owner = [...document.querySelectorAll("code, span, div")].findLast(
      (el) =>
        getComputedStyle(el).textOverflow !== "ellipsis" &&
        [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue ?? "").includes(token)),
    );
    if (!owner) return null;
    for (let el = owner; el; el = el.parentElement) el.scrollLeft = 0;
    const range = document.createRange();
    range.selectNodeContents(owner);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 0);
    const hasBorder = (el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.borderLeftWidth) > 0 && parseFloat(cs.borderRightWidth) > 0;
    };
    // A tool row has no border (plan §4.3 ToolRow, TR0): its row wrapper is
    // the box the token must stay inside. Elsewhere, the bordered card.
    let card = owner.closest("[data-tool-row-wrapper]") ?? owner.parentElement;
    if (!card?.matches("[data-tool-row-wrapper]")) while (card && !hasBorder(card)) card = card.parentElement;
    if (!card) return null;
    const cardBox = card.getBoundingClientRect();
    const overflowing = [];
    for (let el = owner; el && el !== card.parentElement; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1) {
        overflowing.push({ tag: el.tagName, cls: el.getAttribute("class"), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    }
    const cardInnerRight = cardBox.right - parseFloat(getComputedStyle(card).borderRightWidth);
    return {
      overflowWrap: getComputedStyle(owner).overflowWrap,
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      textWidth: rects.reduce((sum, r) => sum + r.width, 0),
      // From the token's first glyph to the card's inner right edge.
      room: cardInnerRight - Math.min(...rects.map((r) => r.left)),
      glyphRight: Math.max(...rects.map((r) => r.right)),
      cardInnerRight,
      viewport: innerWidth,
      overflowing,
    };
  }, token);

const CASES = [
  ["a commit hash passed to /review (command argument)", COMMIT_HASH, (page) => page.getByRole("button", { name: /\/review/ }).click()],
  ["a long path pattern in a Glob call", GLOB_PATTERN, (page, run) => run({ do: "expandToolRows", tools: ["Glob"] })],
];

describe.skipIf(!ENABLED)("long monospace tokens wrap inside their card (real WebKit)", () => {
  it.each(["ko", "ja", "en"].flatMap((locale) => CASES.map((c) => [locale, ...c])))(
    "%s UI, 390x844 / font scale 125%: %s stays inside its card",
    async (locale, _label, token, open) => {
      const session = await openScenario(browser, app, SCENARIO_ID, { locale, variant: { fontScale: 1.25 } });
      try {
        const scenario = expandScenarios().find((s) => s.id === SCENARIO_ID);
        const run = createActions({ session, scenario, manifest: app.fixture, t: session.t });
        await open(session.page, run);
        const geometry = await tokenGeometry(session.page, token);
        expect(geometry, `no element with the token or no card around it: ${token}`).not.toBeNull();
        const detail = JSON.stringify(geometry);
        // The case only proves something if the token cannot fit its room on one line.
        expect(geometry.textWidth, `token fits unbroken: ${detail}`).toBeGreaterThan(geometry.room);
        expect(geometry.glyphRight, detail).toBeLessThanOrEqual(geometry.cardInnerRight + 0.5);
        expect(geometry.glyphRight, detail).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.overflowing, detail).toEqual([]);
      } finally {
        await session.close();
      }
    },
    120_000,
  );
});
