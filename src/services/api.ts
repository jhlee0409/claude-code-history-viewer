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

import { isTauri, getApiBase, getAuthToken, setAuthToken } from "@/utils/platform";

/**
 * Call a backend command regardless of runtime environment.
 *
 * @param command  Tauri command name (also used as the REST endpoint name)
 * @param args     Optional arguments object (serialised as JSON body in web mode)
 * @returns        The deserialised response from the backend
 */
export async function api<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return args != null ? invoke<T>(command, args) : invoke<T>(command);
  }

  const base = getApiBase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${base}/api/${command}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args ?? {}),
  });

  // On 401, prompt for the token and retry once
  if (response.status === 401) {
    const entered = window.prompt("Authentication required. Enter token:");
    if (entered) {
      setAuthToken(entered);
      return api<T>(command, args);
    }
    throw new Error("Authentication required");
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(errorBody) as { error?: string };
      message = parsed.error ?? errorBody;
    } catch {
      message = errorBody;
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
