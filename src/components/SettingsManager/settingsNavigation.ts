/**
 * Settings Navigation Helpers
 *
 * Provides module-level requested section state to support navigation
 * to specific settings sections before or during component mount.
 * Extracted from UnifiedSettingsManager to satisfy react-refresh/only-export-components.
 */

// Module-level target section request for navigation before mount
let pendingSettingsSectionRequest: string | null = null;

/**
 * Requests navigation to a specific settings section upon component mount.
 * Sets a module-level target section identifier consumed by UnifiedSettingsManager.
 *
 * @param sectionId - The identifier of the settings section to navigate to (e.g. "sessionResume")
 */
export function requestSettingsSection(sectionId: string) {
  pendingSettingsSectionRequest = sectionId;
}

/**
 * Consumes and clears the pending requested settings section.
 *
 * @returns The requested section identifier if set, or null otherwise.
 */
export function consumeRequestedSettingsSection(): string | null {
  const section = pendingSettingsSectionRequest;
  pendingSettingsSectionRequest = null;
  return section;
}
