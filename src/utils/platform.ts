/**
 * Platform detection utilities for Tauri desktop vs WebUI server mode.
 *
 * Uses the presence of `__TAURI_INTERNALS__` on the global window to
 * distinguish between the two runtime environments.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __WEBUI_API_BASE__?: string;
  }
}

/** True when the current platform is macOS. */
export const isMacOS = (): boolean =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

/** True when the action modifier key is held (Cmd on macOS, Ctrl elsewhere). */
export const isActionModifier = (e: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  isMacOS() ? e.metaKey : e.ctrlKey;

/** True when running inside the Tauri desktop shell. */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ != null;

/** True when running in the browser against the Axum WebUI server. */
export const isWebUI = (): boolean => !isTauri();

/**
 * Base URL for WebUI API calls.
 *
 * Defaults to the current origin (same-origin requests when the SPA is
 * served by the Axum server). Can be overridden via `window.__WEBUI_API_BASE__`
 * for development scenarios (e.g. Vite dev server proxying to a remote host).
 */
export const getApiBase = (): string => {
  if (typeof window !== "undefined" && window.__WEBUI_API_BASE__) {
    return window.__WEBUI_API_BASE__;
  }
  return typeof window !== "undefined" ? window.location.origin : "";
};

// ---------------------------------------------------------------------------
// Auth token helpers (WebUI server mode only)
// ---------------------------------------------------------------------------

const AUTH_TOKEN_KEY = "webui-auth-token";

/**
 * Initialise the auth token from the URL query string.
 *
 * Call once at app startup (before React renders).  If the URL contains
 * `?token=<value>`, the token is persisted to `localStorage` and the
 * query parameter is stripped from the address bar so it isn't leaked via
 * Referer headers or browser history.
 */
export function initAuthToken(): void {
  if (isTauri()) return;

  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (token) {
    setAuthToken(token);
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url.toString());
  }
}

/**
 * Recover from `?auth_error=1` by asking user for a token once.
 *
 * Returns true when a reload has been triggered and normal app bootstrap should stop.
 */
export function recoverAuthFromErrorQuery(): boolean {
  if (isTauri()) return false;

  const url = new URL(window.location.href);
  if (url.searchParams.get("auth_error") !== "1") return false;

  const existing = getAuthToken();
  if (existing && existing.trim().length > 0) {
    url.searchParams.delete("auth_error");
    window.history.replaceState(window.history.state, "", url.toString());
    return false;
  }

  const input = window.prompt(
    "Authentication required. Paste your WebUI token to continue:",
  );
  if (!input || input.trim().length === 0) {
    return false;
  }

  setAuthToken(input);
  url.searchParams.delete("auth_error");
  window.history.replaceState(window.history.state, "", url.toString());
  window.location.reload();
  return true;
}

/** Read the saved auth token (returns `null` when unavailable). */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist an auth token to `localStorage`. */
export function setAuthToken(token: string): void {
  try {
    const normalized = token.trim();
    if (normalized.length === 0) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return;
    }
    localStorage.setItem(AUTH_TOKEN_KEY, normalized);
  } catch {
    // localStorage unavailable (e.g. private browsing quota exceeded)
  }
}

/**
 * Open a URL in the system default browser.
 *
 * In Tauri mode, uses `@tauri-apps/plugin-opener` to open links externally.
 * In WebUI/browser mode, falls back to `window.open`.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Remove persisted auth token from `localStorage`. */
export function clearAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // localStorage unavailable
  }
}
