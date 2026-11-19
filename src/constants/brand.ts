/**
 * Product brand name shown to users.
 *
 * The Tauri `productName` (src-tauri/tauri.conf.json) intentionally keeps the
 * legacy name: the Windows NSIS updater keys its uninstall registry entry on
 * it, so changing it would install side by side instead of upgrading.
 */
export const APP_NAME = "Omnilogue";
