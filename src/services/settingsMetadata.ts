import type { SettingsMetadata, SettingsScopeMetadata } from "@/types/settingsMetadata";

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

/** Normalize only this additive contract; leave legacy JSON strings/nulls untouched. */
export function normalizeSettingsMetadata(value: unknown): SettingsMetadata {
  const metadata = object(value);
  const scopes = object(metadata.scopes);
  const scope = (name: string): SettingsScopeMetadata => {
    const item = object(scopes[name]);
    const unknown: SettingsScopeMetadata = { path: null, state: "unknown", readOnly: null };
    if (typeof item.readOnly !== "boolean" || item.readOnly !== (name === "managed")) return unknown;
    if (item.state === "present" || item.state === "missing" || item.state === "read_error") {
      if (typeof item.path !== "string" || item.path.length === 0) return unknown;
      return { path: item.path, state: item.state, readOnly: item.readOnly };
    }
    if (item.state === "no_project" || item.state === "unsupported" || item.state === "resolve_error") {
      if (item.path !== null || (item.state === "no_project" && name !== "project" && name !== "local") || (item.state === "unsupported" && name !== "managed")) return unknown;
      return { path: null, state: item.state, readOnly: item.readOnly };
    }
    return unknown;
  };
  return {
    serverHome: typeof metadata.serverHome === "string" && metadata.serverHome.length > 0 ? metadata.serverHome : null,
    scopes: { user: scope("user"), project: scope("project"), local: scope("local"), managed: scope("managed") },
  };
}
