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
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // localStorage unavailable (e.g. private browsing quota exceeded)
  }
}
