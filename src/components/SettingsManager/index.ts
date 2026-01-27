/**
 * SettingsManager Module Exports
 *
 * This module provides a unified settings manager interface
 * for Claude Code configuration across multiple scopes.
 */

// Main component
export { UnifiedSettingsManager as SettingsManager } from "./UnifiedSettingsManager";
export {
  UnifiedSettingsManager,
  useSettingsManager,
  SettingsManagerContext,
  type SettingsManagerContextValue,
} from "./UnifiedSettingsManager";

// Core components
export { EmptyState } from "./components/EmptyState";
export { ExportImport } from "./components/ExportImport";

// Sidebar components
export * from "./sidebar";

// Editor components
export * from "./editor";

// Section components
export * from "./sections";

// Dialog components
export * from "./dialogs";
