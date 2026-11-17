import { afterEach, describe, expect, it } from "vitest";
import {
  OPEN_SETTINGS_SECTION_EVENT,
  consumeRequestedSettingsSection,
  openSettingsSection,
} from "./settingsNavigation";

describe("openSettingsSection", () => {
  afterEach(() => {
    consumeRequestedSettingsSection();
  });

  it("notifies a mounted settings manager", () => {
    const received: string[] = [];
    const listener = (e: Event) => received.push((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_SETTINGS_SECTION_EVENT, listener);
    openSettingsSection("session-resume");
    window.removeEventListener(OPEN_SETTINGS_SECTION_EVENT, listener);
    expect(received).toEqual(["session-resume"]);
  });

  it("leaves the request for a settings manager that mounts later", () => {
    openSettingsSection("session-resume");
    expect(consumeRequestedSettingsSection()).toBe("session-resume");
    expect(consumeRequestedSettingsSection()).toBeNull();
  });
});
