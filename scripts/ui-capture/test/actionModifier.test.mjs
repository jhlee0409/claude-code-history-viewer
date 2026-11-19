// The harness's ⌘/Ctrl key must be the one the app reads (src/utils/platform.ts
// isActionModifier: Meta when navigator.userAgent says Mac, Control otherwise),
// not the one of the machine running the browser. Playwright's WebKit reports
// a Macintosh user agent on every host, while its "ControlOrMeta" resolves by
// the host OS: on a Linux runner it sent Control to an app waiting for Meta,
// so "⌘+click opens a new tab" opened nothing (tabsFocus.test, CI ubuntu).

import { describe, expect, it } from "vitest";
import { actionModifier, actionModifierFor } from "../lib/browser.mjs";

const WEBKIT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15";
const CHROMIUM_LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.0.0 Safari/537.36";
const CHROMIUM_WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

describe("actionModifierFor", () => {
  it("is Meta for a Mac user agent, whatever the host (Playwright WebKit on Linux)", () => {
    expect(actionModifierFor(WEBKIT_UA)).toBe("Meta");
  });

  it("is Control for Linux and Windows user agents", () => {
    expect(actionModifierFor(CHROMIUM_LINUX_UA)).toBe("Control");
    expect(actionModifierFor(CHROMIUM_WINDOWS_UA)).toBe("Control");
  });
});

describe("actionModifier", () => {
  it("reads the user agent from the page, not from the host", async () => {
    const page = { evaluate: async () => WEBKIT_UA };
    await expect(actionModifier(page)).resolves.toBe("Meta");
  });
});
