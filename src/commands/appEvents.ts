/**
 * Window events a command sends to a component that owns the action, so the
 * command layer does not import the component.
 */

/** The desktop updater listens for it (`SimpleUpdateManager`). */
export const MANUAL_UPDATE_CHECK_EVENT = "manual-update-check";

/** The toolbar's gear menu listens for it and opens (`SettingDropdown`). */
export const OPEN_PREFERENCES_EVENT = "open-preferences";
