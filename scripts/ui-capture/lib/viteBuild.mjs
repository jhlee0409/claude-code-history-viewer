// A real production frontend build for tests: the same `vite build` that
// Tauri packages and the WebUI serves, written to a temp dir (~3s).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Build the app into a new temp dir and return its real path (caller removes it). */
export function buildDist(prefix = "cchv-dist-") {
  const outDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  // A test runner's NODE_ENV=test / VITEST* must not leak into the build.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === "NODE_ENV" || key.startsWith("VITEST")) delete env[key];
  const result = spawnSync(
    process.execPath,
    [path.join(REPO, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
    { cwd: REPO, env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error(`vite build failed:\n${result.stderr}${result.stdout}`);
  }
  return outDir;
}

/** All files under `dir`, relative, with `/` separators. */
export function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

/** The app's main stylesheet in a dist (assets/index-<hash>.css). */
export function mainStylesheet(dist) {
  const sheets = listFiles(dist).filter((file) => /^assets\/index-[\w-]+\.css$/.test(file));
  if (sheets.length !== 1) throw new Error(`expected one assets/index-*.css in ${dist}, found ${sheets.length}`);
  return sheets[0];
}
