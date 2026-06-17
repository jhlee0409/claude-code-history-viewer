import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_OPEN_HELPER_ATTRIBUTE,
  clearAuthCookie,
  clearAuthErrorQuery,
  clearAuthToken,
  getApiBase,
  getAssetPath,
  getAuthToken,
  getCsrfToken,
  getWebUIBasePath,
  hasAuthErrorQuery,
  initAuthToken,
  loginWebUI,
  openExternalUrl,
  setAuthToken,
  syncAuthCookieFromStoredToken,
} from "./platform";

describe("platform auth token helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    document.cookie = "cchv_csrf=; Max-Age=0; Path=/";
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

  it("hasAuthErrorQuery is false when auth_error is absent", () => {
    window.history.replaceState({}, "", "/?foo=bar");
    expect(hasAuthErrorQuery()).toBe(false);
  });

  it("clearAuthErrorQuery removes auth_error from the URL", () => {
    window.history.replaceState({}, "", "/?auth_error=1");

    expect(hasAuthErrorQuery()).toBe(true);
    clearAuthErrorQuery();
    expect(new URL(window.location.href).searchParams.get("auth_error")).toBeNull();
  });

  it("loginWebUI posts account credentials", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      loginWebUI({ username: " admin ", password: "secret" })
    ).resolves.toEqual({ ok: true, status: 204 });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}/api/auth/login`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ username: "admin", password: "secret" }),
      })
    );
    expect(getAuthToken()).toBeNull();
  });

  it("syncAuthCookieFromStoredToken exchanges saved token for HttpOnly cookie", async () => {
    setAuthToken("secret-token");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(syncAuthCookieFromStoredToken()).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}/api/auth/login`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ token: "secret-token" }),
      })
    );
    expect(getAuthToken()).toBeNull();
  });

  it("syncAuthCookieFromStoredToken keeps saved token when cookie login fails", async () => {
    setAuthToken("secret-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

    await expect(syncAuthCookieFromStoredToken()).resolves.toBe(false);

    expect(getAuthToken()).toBe("secret-token");
  });

  it("syncAuthCookieFromStoredToken skips request when no token is saved", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(syncAuthCookieFromStoredToken()).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clearAuthCookie asks server to clear cookie", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await clearAuthCookie();

    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}/api/auth/logout`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      })
    );
  });

  it("getCsrfToken reads the csrf cookie", () => {
    document.cookie = "cchv_csrf=csrf-token; Path=/";

    expect(getCsrfToken()).toBe("csrf-token");
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
