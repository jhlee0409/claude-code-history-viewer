import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_OPEN_HELPER_ATTRIBUTE,
  clearAuthToken,
  getApiBase,
  getAssetPath,
  getAuthToken,
  getWebUIBasePath,
  initAuthToken,
  openExternalUrl,
  recoverAuthFromErrorQuery,
  setAuthToken,
} from "./platform";

describe("platform auth token helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    delete window.__WEBUI_API_BASE__;
    delete window.__WEBUI_BASE_PATH__;
    vi.restoreAllMocks();
  });

  it("stores and reads token with trimming", () => {
    setAuthToken("  abc-token  ");
    expect(getAuthToken()).toBe("abc-token");
  });

  it("clears token for empty values", () => {
    setAuthToken("abc");
    setAuthToken("   ");
    expect(getAuthToken()).toBeNull();
  });

  it("clearAuthToken removes stored token", () => {
    setAuthToken("abc");
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
  });

  it("initAuthToken stores token from URL and removes query token", () => {
    window.history.replaceState({}, "", "/?token=xyz");
    initAuthToken();

    expect(getAuthToken()).toBe("xyz");
    expect(new URL(window.location.href).searchParams.get("token")).toBeNull();
  });

  it("recoverAuthFromErrorQuery does nothing when auth_error is absent", () => {
    window.history.replaceState({}, "", "/?foo=bar");
    expect(recoverAuthFromErrorQuery()).toBe(false);
  });

  it("recoverAuthFromErrorQuery clears auth_error when token already exists", () => {
    setAuthToken("abc");
    window.history.replaceState({}, "", "/?auth_error=1");

    expect(recoverAuthFromErrorQuery()).toBe(false);
    expect(new URL(window.location.href).searchParams.get("auth_error")).toBeNull();
  });

  it("recoverAuthFromErrorQuery keeps page when prompt is cancelled", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    window.history.replaceState({}, "", "/?auth_error=1");

    expect(recoverAuthFromErrorQuery()).toBe(false);
    expect(promptSpy).toHaveBeenCalled();
    expect(getAuthToken()).toBeNull();
    expect(new URL(window.location.href).searchParams.get("auth_error")).toBe("1");
  });
});

describe("platform WebUI base path helpers", () => {
  beforeEach(() => {
    delete window.__WEBUI_API_BASE__;
    delete window.__WEBUI_BASE_PATH__;
    window.history.replaceState({}, "", "/viewer/");
  });

  it("uses the current origin at root by default", () => {
    expect(getWebUIBasePath()).toBe("");
    expect(getApiBase()).toBe(window.location.origin);
    expect(getAssetPath("app-icon.png")).toBe("/app-icon.png");
  });

  it("adds the injected base path to API and asset URLs", () => {
    window.__WEBUI_BASE_PATH__ = "/viewer/";

    expect(getWebUIBasePath()).toBe("/viewer");
    expect(getApiBase()).toBe(`${window.location.origin}/viewer`);
    expect(getAssetPath("/app-icon.png")).toBe("/viewer/app-icon.png");
  });

  it("prefers explicit API base override", () => {
    window.__WEBUI_BASE_PATH__ = "/viewer";
    window.__WEBUI_API_BASE__ = "http://127.0.0.1:3727/custom";

    expect(getApiBase()).toBe("http://127.0.0.1:3727/custom");
  });
});

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete window.__WEBUI_API_BASE__;
    delete window.__WEBUI_BASE_PATH__;
  });

  it("rejects unsupported URL schemes", async () => {
    await expect(openExternalUrl("javascript:alert(1)")).rejects.toThrow("Unsupported URL scheme");
  });

  it("opens web URLs through a helper anchor in web mode", async () => {
    const openSpy = vi.spyOn(window, "open");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await expect(openExternalUrl("https://example.com")).resolves.toBeUndefined();

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const helperLink = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(helperLink.getAttribute("href")).toBe("https://example.com");
    expect(helperLink.target).toBe("_blank");
    expect(helperLink.rel).toBe("noopener noreferrer");
    expect(helperLink.getAttribute(EXTERNAL_OPEN_HELPER_ATTRIBUTE)).toBe("true");
    expect(document.querySelector(`[${EXTERNAL_OPEN_HELPER_ATTRIBUTE}]`)).toBeNull();
  });
});
