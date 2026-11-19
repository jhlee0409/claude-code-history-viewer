import { describe, expect, it } from "vitest";
import { collisionHints } from "./projectIdentity";

describe("collisionHints", () => {
  it("leaves rows with a unique label without a hint", () => {
    expect(
      collisionHints([
        { label: "web", hints: ["/work/web", "codex:///work/web"] },
        { label: "api", hints: ["/work/api", "codex:///work/api"] },
      ]),
    ).toEqual([undefined, undefined]);
  });

  it("tells colliding rows apart by the most readable level that differs", () => {
    expect(
      collisionHints([
        { label: "app", hints: ["/client-a/app", "/store/-client-a-app"] },
        { label: "web", hints: ["/work/web", "/store/-work-web"] },
        { label: "app", hints: ["/client-b/app", "/store/-client-b-app"] },
      ]),
    ).toEqual(["/client-a/app", undefined, "/client-b/app"]);
  });

  it("moves the whole colliding set to the next level when the readable one collides", () => {
    expect(
      collisionHints([
        { label: "app", hints: ["/work/app", "Claude Code · /work/app", "/store/-work-app"] },
        { label: "app", hints: ["/work/app", "Codex CLI · /work/app", "codex:///work/app"] },
      ]),
    ).toEqual(["Claude Code · /work/app", "Codex CLI · /work/app"]);
    expect(
      collisionHints([
        { label: "app", hints: ["/work/app", "Claude Code · /work/app", "/a/projects/-work-app"] },
        { label: "app", hints: ["/work/app", "Claude Code · /work/app", "/b/projects/-work-app"] },
      ]),
    ).toEqual(["/a/projects/-work-app", "/b/projects/-work-app"]);
  });

  it("gives no hint to a colliding row that knows nothing about its location", () => {
    expect(
      collisionHints([
        { label: "app", hints: [] },
        { label: "app", hints: ["/work/app"] },
      ]),
    ).toEqual([undefined, "/work/app"]);
  });
});
