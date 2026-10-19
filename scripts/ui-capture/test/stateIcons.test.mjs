// Small state marks render visibly (T5 review, findings 1 and 2), real WebKit.
//
// - The checked item of a radio menu (language, font size, ...) shows a dot.
//   Radix's ItemIndicator is an inline span; a dot that is itself an inline
//   span ignores its w-2 / h-2 and renders 0 × 0, so the selection is
//   invisible. jsdom cannot see that; WebKit can.
// - LoadingState's generic empty / error icons render 24 × 24 with stroke 1.5
//   (the 24 px icon rule), not hand-drawn 32 px / stroke 2 SVGs.
//
// Renders the real components to markup (the menu's portal inlined), styles
// them with the built app stylesheet, and measures in WebKit.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { webkit } from "playwright";
import { buildDist, mainStylesheet } from "../lib/viteBuild.mjs";
import { browserRequirement } from "./requirements.mjs";

vi.hoisted(() => {
  // src/i18n sets html[lang] on import; a node test has no document.
  globalThis.document ??= { documentElement: {} };
});

// Server markup has no portal target: render the menu content in place.
vi.mock("@radix-ui/react-dropdown-menu", async (importOriginal) => ({
  ...(await importOriginal()),
  Portal: ({ children }) => children,
}));

const menu = await import("@/components/ui/dropdown-menu");
const { LoadingState } = await import("@/components/ui/loading");
const { IconProvider } = await import("@/components/icon/Icon");

// CI_REQUIRE_BROWSER=1 (CI ui-harness job) turns a missing WebKit into an error.
const HAS_WEBKIT = browserRequirement({ webkit: true }, { label: "stateIcons.test" }).enabled;

const h = React.createElement;

function radioMenuMarkup() {
  return renderToStaticMarkup(
    h(
      menu.DropdownMenu,
      { open: true, modal: false },
      h(menu.DropdownMenuTrigger, null, "open"),
      h(
        menu.DropdownMenuContent,
        null,
        h(
          menu.DropdownMenuRadioGroup,
          { value: "en" },
          h(menu.DropdownMenuRadioItem, { value: "en" }, "English"),
          h(menu.DropdownMenuRadioItem, { value: "ko" }, "한국어"),
        ),
      ),
    ),
  );
}

function stateMarkup(props) {
  return renderToStaticMarkup(
    h(IconProvider, null, h(LoadingState, { isLoading: false, ...props }, h("p", null, "content"))),
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

beforeAll(async () => {
  if (!HAS_WEBKIT) return;
  dist = buildDist("cchv-state-icons-");
  const stylesheet = `/${mainStylesheet(dist)}`;
  const page = (body) =>
    `<!doctype html><html lang="en"><head><link rel="stylesheet" href="${stylesheet}"></head>` +
    `<body><div style="width:320px">${body}</div></body></html>`;
  const pages = new Map([
    ["/menu", page(radioMenuMarkup())],
    ["/empty", page(stateMarkup({ isEmpty: true }))],
    ["/error", page(stateMarkup({ error: "Something failed" }))],
  ]);
  server = await serve(dist, pages);
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await webkit.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (dist) fs.rmSync(dist, { recursive: true, force: true });
});

async function onPage(pathname, fn) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}${pathname}`);
    return await page.evaluate(fn);
  } finally {
    await page.close();
  }
}

describe.skipIf(!HAS_WEBKIT)("small state marks render visibly (real WebKit)", () => {
  it("the checked radio item shows an 8 × 8 dot; the unchecked one shows none", async () => {
    const result = await onPage("/menu", () => {
      // Radix positions the menu after mount; server markup parks it off-screen.
      const wrapper = document.querySelector("[data-radix-popper-content-wrapper]");
      if (wrapper) wrapper.style.transform = "none";
      const mark = (checked) =>
        document.querySelector(`[role=menuitemradio][aria-checked=${checked}] span[data-state] > *`);
      const dot = mark(true);
      const box = dot?.getBoundingClientRect();
      return {
        width: box?.width ?? -1,
        height: box?.height ?? -1,
        background: dot ? getComputedStyle(dot).backgroundColor : null,
        uncheckedHasMark: mark(false) !== null,
      };
    });
    expect(result).toMatchObject({ width: 8, height: 8, uncheckedHasMark: false });
    expect(result.background).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  }, 60_000);

  it.each(["/empty", "/error"])("%s state icon renders 24 × 24 with stroke 1.5", async (pathname) => {
    const icons = await onPage(pathname, () =>
      [...document.querySelectorAll("svg")].map((svg) => {
        const box = svg.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          strokes: [...new Set([...svg.querySelectorAll("path, line, circle, rect, polyline")].map((el) => getComputedStyle(el).strokeWidth))],
          hidden: svg.getAttribute("aria-hidden"),
        };
      }),
    );
    expect(icons).toEqual([{ width: 24, height: 24, strokes: ["1.5px"], hidden: "true" }]);
  }, 60_000);
});
