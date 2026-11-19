// Build artifacts of a capture run: the frontend bundle and the WebUI server
// binary, for the head checkout and (with --base <git-ref>) the base.
//
// Modes:
//   build      always build (the default)
//   reuse      use what is there; missing artifacts fail (`--no-build` head:
//              CI builds .ui-capture/build itself, before the browser tests)
//   ifMissing  build only when an artifact is missing (`--no-build` base:
//              .ui-capture/build-base/<sha> exists on no clean runner, so
//              reusing it unconditionally failed every cold CI run)

import fs from "node:fs";
import path from "node:path";

export const ARTIFACT_MODES = ["build", "reuse", "ifMissing"];

/** The two files a capture serves from a build directory. */
export const artifactPaths = (buildDir) => ({ dist: path.join(buildDir, "dist"), serverBin: path.join(buildDir, "cchv-server") });

const missingArtifacts = ({ dist, serverBin }) => [path.join(dist, "index.html"), serverBin].filter((f) => !fs.existsSync(f));

/**
 * `--no-build` reuses the head build only. The base is built when its
 * artifacts are absent (and reused when a previous run left them).
 */
export const artifactModes = ({ build }) => (build ? { head: "build", base: "build" } : { head: "reuse", base: "ifMissing" });

/**
 * Build (or reuse) the dist + server binary of `appDir` into `buildDir`.
 * `runBuild({ appDir, dist, serverBin })` does the build (build.sh in run.mjs).
 */
export function prepareArtifacts({ appDir, buildDir, mode, runBuild, log = () => {} }) {
  if (!ARTIFACT_MODES.includes(mode)) throw new Error(`unknown artifact mode ${mode}`);
  const paths = artifactPaths(buildDir);
  const shouldBuild = mode === "build" || (mode === "ifMissing" && missingArtifacts(paths).length > 0);
  if (shouldBuild) {
    log(mode === "ifMissing" ? `no artifacts in ${buildDir}: building` : `building into ${buildDir}`);
    runBuild({ appDir, ...paths });
  }
  const missing = missingArtifacts(paths);
  if (missing.length) {
    const hint = mode === "reuse" ? " (drop --no-build, or run build.sh first)" : " (the build did not produce it)";
    throw new Error(`missing build artifact ${missing[0]}${hint}`);
  }
  return { appDir, ...paths, built: shouldBuild };
}
