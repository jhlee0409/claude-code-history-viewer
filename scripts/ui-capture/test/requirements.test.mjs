// CI_REQUIRE_BROWSER (plan I0): in the CI ui-harness job a missing browser
// or server must fail the suite, not skip it.

import { describe, expect, it } from "vitest";
import { browserRequirement } from "./requirements.mjs";

const none = () => false;
const all = () => true;

describe("browserRequirement", () => {
  it("skips (enabled false) locally when something is missing", () => {
    const r = browserRequirement({ webkit: true, server: true }, { env: {}, exists: none, label: "t" });
    expect(r.enabled).toBe(false);
    expect(r.missing).toHaveLength(2);
  });

  it("throws under CI_REQUIRE_BROWSER=1 instead of skipping", () => {
    expect(() => browserRequirement({ webkit: true }, { env: { CI_REQUIRE_BROWSER: "1" }, exists: none, label: "t" })).toThrow(/CI_REQUIRE_BROWSER=1 but missing: WebKit/);
    expect(() => browserRequirement({ chromium: true, server: true }, { env: { CI_REQUIRE_BROWSER: "1" }, exists: none, label: "t" })).toThrow(/Chromium.*server/);
  });

  it("is enabled when everything is present", () => {
    expect(browserRequirement({ webkit: true, chromium: true, server: true }, { env: { CI_REQUIRE_BROWSER: "1" }, exists: all }).enabled).toBe(true);
  });
});
