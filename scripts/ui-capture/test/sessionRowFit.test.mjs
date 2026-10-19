// Session row fit (plan T4 review, finding 4), real WebKit. The session list
// is a fixed-row virtual list: react-window stacks rows at index × height, so
// a row whose content is taller than sessionItemHeight() overlaps the next
// one. Renders the real SessionItem (server markup) with the worst-case
// content - a two-line name, the CLI name badge, padded storage and client
// badges, the selection checkbox - in every app language, styles it with the
// built app stylesheet and bundled fonts, and requires it to fit the slot at
// 90/100/110/130% font scale.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webkit } from "playwright";
import { buildDist, mainStylesheet } from "../lib/viteBuild.mjs";
import { browserRequirement } from "./requirements.mjs";

const state = vi.hoisted(() => {
  // src/i18n sets html[lang] on import; a node test has no document.
  globalThis.document ??= { documentElement: {} };
  return { hasClaudeCodeName: false };
});

vi.mock("@/hooks/useSessionMetadata", () => ({
  useSessionDisplayName: (_sessionId, fallbackSummary) => fallbackSummary,
  useSessionMetadata: () => ({
    hasClaudeCodeName: state.hasClaudeCodeName,
    setHasClaudeCodeName: () => {},
    setCustomName: async () => {},
    customName: undefined,
    starred: false,
    tags: [],
    notes: undefined,
    isMetadataLoaded: true,
  }),
}));

const { default: i18n } = await import("@/i18n");
const { SessionItem } = await import("@/components/SessionItem");
const { sessionItemHeight } = await import("@/components/ProjectTree/components/sessionItemHeight");

// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit into an error.
const HAS_WEBKIT = browserRequirement({ webkit: true }, { label: "sessionRowFit.test" }).enabled;

const SCALES = [90, 100, 110, 130];
// Long enough to wrap past two lines at the row width (line-clamp-2 caps it).
const NAMES = {
  en: "Refactor the session list virtualization so that rows never overlap when the font scale changes",
  ko: "글꼴 크기가 바뀌어도 세션 목록의 행이 겹치지 않도록 가상 스크롤 높이를 다시 계산하고 검증하기",
  ja: "フォントサイズを変更してもセッション一覧の行が重ならないように仮想スクロールの高さを再計算する",
  "zh-CN": "调整字体大小时重新计算会话列表虚拟滚动的行高，确保各行之间永远不会互相重叠",
  "zh-TW": "調整字體大小時重新計算會話列表虛擬捲動的列高，確保各列之間永遠不會互相重疊",
};
// The sidebar's narrowest session column (sidebar minus the list indent).
const ROW_WIDTH_PX = 220;

function rowMarkup(locale, { cliBadge, selectionMode }) {
  state.hasClaudeCodeName = cliBadge;
  const session = {
    session_id: `s-${locale}`,
    actual_session_id: `s-${locale}`,
    file_path: `/tmp/${locale}.jsonl`,
    project_name: "p",
    message_count: 12345,
    first_message_time: "2026-01-01T00:00:00Z",
    last_message_time: "2026-01-01T00:00:00Z",
    last_modified: "2026-01-01T00:00:00Z",
    has_tool_use: true,
    has_errors: true,
    summary: NAMES[locale],
    storage_type: "sqlite",
    entrypoint: "claude-vscode",
    provider: "claude",
  };
  return renderToStaticMarkup(
    React.createElement(SessionItem, {
      session,
      isSelected: true,
      onSelect: () => {},
      formatTimeAgo: () => "12 hours ago",
      isSelectionMode: selectionMode,
      isChecked: selectionMode,
    }),
  );
}

function serve(root, pages) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (pages.has(url.pathname)) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(pages.get(url.pathname));
    }
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    const type = { ".css": "text/css", ".woff2": "font/woff2" }[path.extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let dist;
let browser;
let server;
let origin;
const pages = new Map();

beforeAll(async () => {
  if (!HAS_WEBKIT) return;
  dist = buildDist("cchv-session-row-");
  const stylesheet = `/${mainStylesheet(dist)}`;
  for (const locale of Object.keys(NAMES)) {
    await i18n.changeLanguage(locale);
    const variants = [
      { cliBadge: false, selectionMode: false },
      { cliBadge: true, selectionMode: false },
      { cliBadge: false, selectionMode: true },
    ];
    const rows = variants
      .map((variant) => `<div class="slot" data-variant='${JSON.stringify(variant)}'>${rowMarkup(locale, variant)}</div>`)
      .join("");
    pages.set(
      `/${locale}`,
      `<!doctype html><html lang="${locale}"><head><link rel="stylesheet" href="${stylesheet}"></head>` +
        `<body><div style="width:${ROW_WIDTH_PX}px">${rows}</div></body></html>`,
    );
  }
  server = await serve(dist, pages);
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await webkit.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (dist) fs.rmSync(dist, { recursive: true, force: true });
});

/** Height of every rendered row at a font scale (fonts loaded). */
async function measureRows(page, scalePercent) {
  return page.evaluate(async (scale) => {
    document.documentElement.style.setProperty("--app-font-scale", String(scale / 100));
    await document.fonts.ready;
    return [...document.querySelectorAll(".slot")].map((slot) => {
      const row = slot.firstElementChild;
      const name = row.querySelector(".line-clamp-2");
      return {
        variant: slot.dataset.variant,
        height: row.getBoundingClientRect().height,
        nameLines: name ? Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)) : 0,
      };
    });
  }, scalePercent);
}

describe.skipIf(!HAS_WEBKIT)("session row fits its virtual-list slot (real WebKit)", () => {
  it.each(Object.keys(NAMES))("%s: worst-case rows fit at 90, 100, 110 and 130 percent font scale", async (locale) => {
    const page = await browser.newPage();
    try {
      await page.goto(`${origin}/${locale}`);
      const overflows = [];
      for (const scale of SCALES) {
        const slot = sessionItemHeight(scale);
        for (const row of await measureRows(page, scale)) {
          expect(row.nameLines, `${locale} ${scale}% ${row.variant}: two-line name`).toBe(2);
          if (row.height > slot) overflows.push(`${scale}% ${row.variant}: ${row.height}px > ${slot}px slot`);
        }
      }
      expect(overflows).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
