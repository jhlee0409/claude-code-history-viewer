// Build artifacts for head and base (review R1): `ui:capture --no-build
// --base <sha>` is the CI gate command. CI builds only the head into
// .ui-capture/build; on a clean runner .ui-capture/build-base/<sha> does not
// exist, so `--no-build` must not stop the base from being built.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactModes, artifactPaths, prepareArtifacts } from "../lib/artifacts.mjs";

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ui-capture-artifacts-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A stand-in for build.sh: writes the two artifacts and records the call. */
function fakeBuild(calls) {
  return ({ appDir, dist, serverBin }) => {
    calls.push(appDir);
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html>");
    fs.mkdirSync(path.dirname(serverBin), { recursive: true });
    fs.writeFileSync(serverBin, "bin");
  };
}

describe("--no-build artifact modes", () => {
  it("--no-build reuses the head build but not the base", () => {
    expect(artifactModes({ build: false })).toEqual({ head: "reuse", base: "ifMissing" });
    expect(artifactModes({ build: true })).toEqual({ head: "build", base: "build" });
  });

  it("clean runner: no build-base dir at all → the base is built (CI command --no-build --base <sha>)", () => {
    const head = path.join(root, ".ui-capture", "build");
    fakeBuild([])({ appDir: "head", ...artifactPaths(head) }); // the CI step `build.sh . .ui-capture/build/...`
    const baseDir = path.join(root, ".ui-capture", "build-base", "d7b7ff3ab50b");
    expect(fs.existsSync(path.dirname(baseDir))).toBe(false);

    const modes = artifactModes({ build: false });
    const calls = [];
    const headArtifacts = prepareArtifacts({ appDir: "head", buildDir: head, mode: modes.head, runBuild: fakeBuild(calls) });
    const baseArtifacts = prepareArtifacts({ appDir: "base-worktree", buildDir: baseDir, mode: modes.base, runBuild: fakeBuild(calls) });

    expect(calls).toEqual(["base-worktree"]); // head reused, base built
    expect(headArtifacts.built).toBe(false);
    expect(baseArtifacts.built).toBe(true);
    expect(fs.existsSync(path.join(baseDir, "dist", "index.html"))).toBe(true);
  });

  it("warm base: artifacts left by an earlier run are reused, not rebuilt", () => {
    const baseDir = path.join(root, "build-base", "abc");
    fakeBuild([])({ appDir: "earlier", ...artifactPaths(baseDir) });
    const calls = [];
    const base = prepareArtifacts({ appDir: "base-worktree", buildDir: baseDir, mode: artifactModes({ build: false }).base, runBuild: fakeBuild(calls) });
    expect(calls).toEqual([]);
    expect(base.built).toBe(false);
  });

  it("a half-built base (bundle without server) is rebuilt", () => {
    const baseDir = path.join(root, "build-base", "abc");
    fs.mkdirSync(path.join(baseDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(baseDir, "dist", "index.html"), "x");
    const calls = [];
    prepareArtifacts({ appDir: "base-worktree", buildDir: baseDir, mode: "ifMissing", runBuild: fakeBuild(calls) });
    expect(calls).toEqual(["base-worktree"]);
  });

  it("--no-build head without a build fails with the reason, and never builds", () => {
    const calls = [];
    expect(() => prepareArtifacts({ appDir: "head", buildDir: path.join(root, "build"), mode: "reuse", runBuild: fakeBuild(calls) })).toThrow(
      /missing build artifact .*index\.html \(drop --no-build/,
    );
    expect(calls).toEqual([]);
  });

  it("a build that produces nothing fails instead of capturing a missing app", () => {
    expect(() => prepareArtifacts({ appDir: "x", buildDir: path.join(root, "b"), mode: "ifMissing", runBuild: () => {} })).toThrow(/the build did not produce it/);
  });
});
