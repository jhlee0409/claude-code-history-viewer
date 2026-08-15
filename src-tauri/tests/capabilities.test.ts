import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const defaultCapabilityPath = path.join(__dirname, "../capabilities/default.json");

describe("Tauri Capabilities", () => {
  const expectedPermissions = [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:app:allow-version",
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize",
    "dialog:allow-open",
    "dialog:allow-save",
    "process:allow-restart",
    "updater:allow-check",
    "updater:allow-download",
    "updater:allow-install",
    "updater:allow-download-and-install",
    "store:allow-load",
    "store:allow-get",
    "store:allow-set",
    "store:allow-save",
    "opener:allow-reveal-item-in-dir",
    {
      identifier: "opener:allow-open-url",
      allow: [
        { url: "http://*" },
        { url: "https://*" },
        { url: "mailto:*" },
      ],
    },
    "os:allow-locale",
  ];

  it("matches the reviewed least-privilege permission allowlist exactly", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));

    expect(capability.permissions).toEqual(expectedPermissions);
  });

  it("includes process restart permission required by plugin-process relaunch", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));
    expect(capability.permissions).toContain("process:allow-restart");
  });

  it("keeps updater permissions enabled for in-app update flow", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));
    expect(capability.permissions).toEqual(expect.arrayContaining([
      "updater:allow-check",
      "updater:allow-download",
      "updater:allow-install",
      "updater:allow-download-and-install",
    ]));
    expect(capability.permissions).not.toContain("updater:default");
  });

  it("does not grant broad default or unused plugin permissions", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));
    expect(capability.permissions).not.toContain("core:default");
    expect(capability.permissions).not.toContain("dialog:default");
    expect(capability.permissions).not.toContain("http:default");
    expect(capability.permissions).not.toContain("fs:default");
  });

  it("scopes external URL opening to schemes used by the app", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));
    const openerPermission = capability.permissions.find(
      (permission: unknown) =>
        typeof permission === "object" &&
        permission !== null &&
        (permission as { identifier?: string }).identifier === "opener:allow-open-url"
    );

    expect(openerPermission).toEqual({
      identifier: "opener:allow-open-url",
      allow: [
        { url: "http://*" },
        { url: "https://*" },
        { url: "mailto:*" },
      ],
    });
  });

  it("keeps only the window permissions required by the custom title bar", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));

    expect(capability.permissions).toEqual(expect.arrayContaining([
      "core:window:allow-start-dragging",
      "core:window:allow-internal-toggle-maximize",
    ]));
    expect(capability.permissions).not.toContain("core:window:default");
  });
});
