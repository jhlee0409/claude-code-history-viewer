/**
 * Unified API adapter — seamlessly switches between Tauri IPC and HTTP fetch.
 *
 * In Tauri desktop mode, delegates to `@tauri-apps/api/core` invoke().
 * In WebUI server mode, POSTs JSON to the Axum `/api/{command}` endpoint.
 *
 * Usage:
 *   import { api } from "@/services/api";
 *   const result = await api<MyType>("command_name", { key: "value" });
 */

import {
  isTauri,
  getApiBase,
  getAuthToken,
  getCsrfToken,
  setAuthToken,
  clearAuthToken,
  clearAuthCookie,
} from "@/utils/platform";

/** Validate command name to prevent path traversal in URL. */
const COMMAND_RE = /^[a-zA-Z0-9_]+$/;

/**
 * Call a backend command regardless of runtime environment.
 *
 * @param command  Tauri command name (also used as the REST endpoint name)
 * @param args     Optional arguments object (serialised as JSON body in web mode)
 * @param _retried Internal flag to prevent infinite retry on 401
 * @returns        The deserialised response from the backend
 */
export async function api<T>(
  command: string,
  args?: Record<string, unknown>,
  _retried = false,
): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return args != null ? invoke<T>(command, args) : invoke<T>(command);
  }

  if (!COMMAND_RE.test(command)) {
    throw new Error(`Invalid command name: ${command}`);
  }

  const base = getApiBase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(`${base}/api/${command}`, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify(args ?? {}),
  });

  // On 401, try to extract token from URL params and retry once.
  // If no token is available, redirect to force re-authentication.
  if (response.status === 401 && !_retried) {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      setAuthToken(urlToken);
      return api<T>(command, args, true);
    }

    // Avoid redirect loops when already on an auth error page.
    if (params.get("auth_error") === "1") {
      clearAuthToken();
      await clearAuthCookie();
      throw new Error("Authentication required.");
    }

    // Clear stale token and redirect once to an explicit auth-error URL.
    clearAuthToken();
    await clearAuthCookie();
    params.set("auth_error", "1");
    const query = params.toString();
    window.location.replace(
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
    throw new Error("Authentication required");
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody) as { error?: string };
      message = parsed.error ?? "Request failed";
    } catch {
      message = "Request failed";
    }
    // Log full error for debugging, show sanitized message to user
    console.error(`API error [${command}]:`, errorBody);
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
