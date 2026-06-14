import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_OPEN_HELPER_ATTRIBUTE,
  clearAuthCookie,
  clearAuthToken,
  getAuthToken,
  initAuthToken,
  openExternalUrl,
  recoverAuthFromErrorQuery,
  setAuthToken,
  syncAuthCookieFromStoredToken,
} from "./platform";

describe("platform auth token helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
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
});

describe("openExternalUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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
