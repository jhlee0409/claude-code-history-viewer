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
