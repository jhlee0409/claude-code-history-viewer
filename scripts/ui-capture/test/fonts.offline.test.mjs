// Offline font test (plan T4 VERIFY / §9b C5), real WebKit. Serves the
// bundled src/assets/fonts (fonts.css + woff2) from a local server, blocks
// every other origin, and requires every bundled face to really load. A
// deliberately broken woff2 must make the same check fail. The same checks
// then run on a real `vite build` of the app - what Tauri packages - which
// must also ship both OFL license files.

import { spawnSync } from "node:child_process";
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
const PAGE = (withExternal, stylesheet = "/fonts.css") => `<!doctype html><html lang="en"><head>
<link rel="stylesheet" href="${stylesheet}">
${withExternal ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' : ""}
</head><body style="font-family:'IBM Plex Sans'">Ag <i>Ag</i> <code style="font-family:'JetBrains Mono'">Ag</code></body></html>`;

const TYPES = { ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html", ".txt": "text/plain" };

function serve(root, { withExternal = false, stylesheet } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGE(withExternal, stylesheet));
    }
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
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

/** All files under `dir`, relative, with `/` separators. */
function listFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

/** A real production frontend build (the dist Tauri bundles), into a temp dir. */
function buildDist() {
  const outDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cchv-fonts-dist-")));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === "NODE_ENV" || key.startsWith("VITEST")) delete env[key];
  const result = spawnSync(process.execPath, [path.join(REPO, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: REPO,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`vite build failed:\n${result.stderr}${result.stdout}`);
  return outDir;
}

describe("built dist (vite build)", () => {
  let dist;
  beforeAll(() => {
    dist = buildDist();
  }, 180_000);
  afterAll(() => {
    if (dist) fs.rmSync(dist, { recursive: true, force: true });
  });

  it("ships both OFL license files, served from the dist", async () => {
    const files = listFiles(dist);
    const server = await serve(dist);
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const family of ["ibm-plex-sans", "jetbrains-mono"]) {
        const source = fs.readFileSync(path.join(FONTS, family, "OFL.txt"), "utf8");
        const shipped = files.filter((file) => file.endsWith("OFL.txt") && file.includes(family));
        expect(shipped, `${family} OFL.txt in dist (${files.filter((f) => f.endsWith(".txt"))})`).toHaveLength(1);
        const response = await fetch(`${origin}/${shipped[0]}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(source);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it.skipIf(!HAS_WEBKIT)("loads every face from the built stylesheet with the network blocked", async () => {
    const stylesheets = listFiles(dist).filter((file) => /^assets\/index-[\w-]+\.css$/.test(file));
    expect(stylesheets).toHaveLength(1);
    const { problems, faces, traffic } = await checkFontsServedFrom(dist, { stylesheet: `/${stylesheets[0]}` });
    expect(problems).toEqual([]);
    expect(faces).toHaveLength(REQUIRED_FACES.length);
    expect(traffic.external).toEqual([]);
  }, 60_000);
});
