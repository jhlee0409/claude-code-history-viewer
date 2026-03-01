import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const defaultCapabilityPath = path.join(__dirname, "../capabilities/default.json");

describe("Tauri Capabilities", () => {
  it("includes process restart permission required by plugin-process relaunch", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));
    expect(capability.permissions).toContain("process:allow-restart");
  });

  it("keeps updater permissions enabled for in-app update flow", () => {
    const capability = JSON.parse(fs.readFileSync(defaultCapabilityPath, "utf-8"));
    expect(capability.permissions).toContain("updater:default");
    expect(capability.permissions).toContain("updater:allow-check");
  });
});
