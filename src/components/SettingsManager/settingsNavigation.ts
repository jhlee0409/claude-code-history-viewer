/**
 * Settings Navigation Helpers
 *
 * Opens a specific settings section whether or not the settings manager is
 * mounted yet: a mounted manager hears the event, and one that mounts later
 * consumes the pending request. Kept outside UnifiedSettingsManager to satisfy
 * react-refresh/only-export-components.
 */

export const OPEN_SETTINGS_SECTION_EVENT = "open-settings-section";

let pendingSettingsSectionRequest: string | null = null;

/**
 * Asks the settings manager to open a section (e.g. "session-resume").
 * Callers still switch the app to the settings view themselves.
 */
export function openSettingsSection(sectionId: string) {
  pendingSettingsSectionRequest = sectionId;
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_SECTION_EVENT, { detail: sectionId })
  );
}

/**
 * Consumes and clears the pending section request.
 *
 * @returns The requested section identifier if set, or null otherwise.
 */
export function consumeRequestedSettingsSection(): string | null {
  const section = pendingSettingsSectionRequest;
  pendingSettingsSectionRequest = null;
  return section;
}
