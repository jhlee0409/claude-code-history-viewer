// Offline font test (plan T4 VERIFY / §9b C5), real WebKit. Serves the
// bundled src/assets/fonts (fonts.css + woff2) from a local server, blocks
// every other origin, and requires every bundled face to really load. A
// deliberately broken woff2 must make the same check fail.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webkit } from "playwright";
import { REQUIRED_FACES, fontProblems, loadRequiredFaces, watchFontTraffic } from "../lib/fonts.mjs";

const HAS_WEBKIT = fs.existsSync(webkit.executablePath());
if (!HAS_WEBKIT) console.warn(`[ui-capture] skipping fonts.offline.test: no WebKit at ${webkit.executablePath()}`);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FONTS = path.join(REPO, "src", "assets", "fonts");
const BROKEN_FILE = path.join("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2");

// The page references a Google font as well: it must be blocked and reported.
const PAGE = (withExternal) => `<!doctype html><html lang="en"><head>
<link rel="stylesheet" href="/fonts.css">
${withExternal ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' : ""}
</head><body style="font-family:'IBM Plex Sans'">Ag <i>Ag</i> <code style="font-family:'JetBrains Mono'">Ag</code></body></html>`;

const TYPES = { ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html" };

function serve(root, { withExternal = false } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGE(withExternal));
    }
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let browser;
beforeAll(async () => {
  if (HAS_WEBKIT) browser = await webkit.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function checkFontsServedFrom(root, options) {
  const server = await serve(root, options);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  try {
    // Offline: everything that is not the local server is aborted.
    await context.route((url) => url.origin !== origin, (route) => route.abort("internetdisconnected"));
    const page = await context.newPage();
    const traffic = watchFontTraffic(page, origin);
    await page.goto(`${origin}/`);
    const faces = await loadRequiredFaces(page);
    return { faces, traffic, problems: fontProblems({ faces, traffic }) };
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("bundled fonts", () => {
  it("ship every face index.html used to load from Google Fonts, with OFL license files", () => {
    const css = fs.readFileSync(path.join(FONTS, "fonts.css"), "utf8");
    for (const face of REQUIRED_FACES) {
      const block = new RegExp(
        `font-family: '${face.family}';\\s*font-style: ${face.style};[^}]*font-weight: ${face.weight};[^}]*url\\(\\./[\\w-]+/[\\w.-]+\\.woff2\\)`,
      );
      expect(css, `${face.family} ${face.weight} ${face.style}`).toMatch(block);
    }
    expect(css).not.toMatch(/https?:\/\//);
    for (const family of ["ibm-plex-sans", "jetbrains-mono"]) {
      expect(fs.readFileSync(path.join(FONTS, family, "OFL.txt"), "utf8")).toMatch(/SIL Open Font License/);
    }
  });

  it("index.html no longer loads fonts from a CDN", () => {
    const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});

describe.skipIf(!HAS_WEBKIT)("offline font loading (real WebKit)", () => {
  it("loads every bundled face from local files with the network blocked", async () => {
    const { problems, faces, traffic } = await checkFontsServedFrom(FONTS);
    expect(problems).toEqual([]);
    expect(faces).toHaveLength(REQUIRED_FACES.length);
    expect(traffic.external).toEqual([]);
    expect(traffic.responses.every((r) => r.ok && r.url.endsWith(".woff2"))).toBe(true);
  }, 60_000);

  it("reports an external font request (zero allowed)", async () => {
    const { problems } = await checkFontsServedFrom(FONTS, { withExternal: true });
    expect(problems.some((p) => p.startsWith("external font request https://fonts.googleapis.com/"))).toBe(true);
  }, 60_000);

  it("fails when a bundled font file is broken (negative case)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cchv-fonts-broken-"));
    try {
      fs.cpSync(FONTS, root, { recursive: true });
      fs.writeFileSync(path.join(root, BROKEN_FILE), Buffer.from("this is not a woff2 file"));
      const { problems } = await checkFontsServedFrom(fs.realpathSync(root));
      expect(problems.some((p) => p.startsWith("IBM Plex Sans 400 normal:"))).toBe(true);
      // the other faces are unaffected
      expect(problems.every((p) => p.startsWith("IBM Plex Sans 400 normal:"))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
