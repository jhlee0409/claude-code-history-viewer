/** Read-time backend evidence; never a save permission or browser path guess. */
export type SettingsFileState =
  | "present" | "missing" | "read_error" | "no_project"
  | "unsupported" | "resolve_error" | "unknown";

export interface SettingsScopeMetadata {
  path: string | null;
  state: SettingsFileState;
  /** Scope policy, not filesystem writability. null means legacy/unknown. */
  readOnly: boolean | null;
}

export interface SettingsMetadata {
  serverHome: string | null;
  scopes: Record<"user" | "project" | "local" | "managed", SettingsScopeMetadata>;
}
