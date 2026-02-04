export { useToggle } from "./useToggle";

// ===== PRESET MANAGEMENT HOOKS =====
// PRIMARY API: Use useUnifiedPresets for all preset operations
export { useUnifiedPresets } from "./useUnifiedPresets";
export type { UseUnifiedPresetsResult } from "./useUnifiedPresets";

// DEPRECATED: Use useUnifiedPresets instead (removal planned for v2.0)
// @deprecated - Settings-only presets, replaced by unified presets
export { usePresets, usePresetSelection } from "./usePresets";
export type { UsePresetsResult } from "./usePresets";
// @deprecated - MCP-only presets, replaced by unified presets
export { useMCPPresets } from "./useMCPPresets";
export type { UseMCPPresetsResult } from "./useMCPPresets";

// MCP SERVER CONFIGURATION
export { useMCPServers } from "./useMCPServers";
export type { UseMCPServersResult } from "./useMCPServers";

// FILE WATCHER
export { useFileWatcher } from "./useFileWatcher";
export type { UseFileWatcherResult } from "./useFileWatcher";
