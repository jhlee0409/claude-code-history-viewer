// Which real-browser tests can run here, and what to do when they cannot.
//
// Locally a missing WebKit/Chromium build or a missing harness server binary
// skips the browser suites (with a console warning). In CI the `ui-harness`
// job sets CI_REQUIRE_BROWSER=1 after installing the browsers and building
// the server (plan I0, clean-runner order 1-5); there a missing requirement is
// an error, so a suite can never pass by being skipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const SERVER_BIN = path.join(REPO, ".ui-capture", "build", "cchv-server");

export const browserRequired = (env = process.env) => env.CI_REQUIRE_BROWSER === "1";

/**
 * `{ enabled, missing }` for a suite that needs `webkit` / `chromium` / the
 * harness `server`. Throws when CI_REQUIRE_BROWSER=1 and something is missing.
 */
export function browserRequirement(
  { webkit: needWebkit = false, chromium: needChromium = false, server: needServer = false } = {},
  { env = process.env, exists = fs.existsSync, label = "ui-capture" } = {},
) {
  const missing = [];
  if (needWebkit && !exists(webkit.executablePath())) missing.push(`WebKit at ${webkit.executablePath()}`);
  if (needChromium && !exists(chromium.executablePath())) missing.push(`Chromium at ${chromium.executablePath()}`);
  if (needServer && !exists(SERVER_BIN)) missing.push(`server at ${SERVER_BIN} (run scripts/ui-capture/build.sh)`);
  if (missing.length === 0) return { enabled: true, missing };
  if (browserRequired(env)) {
    throw new Error(`[${label}] CI_REQUIRE_BROWSER=1 but missing: ${missing.join("; ")}`);
  }
  console.warn(`[${label}] skipping: no ${missing.join("; no ")}`);
  return { enabled: false, missing };
}
