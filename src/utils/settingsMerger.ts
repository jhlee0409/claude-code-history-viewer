/**
 * Settings Merger Utility
 *
 * Merges Claude Code settings from multiple scopes according to
 * the official Claude Code precedence rules.
 *
 * Precedence (highest to lowest):
 * 1. managed (100) - Cannot be overridden
 * 2. local (30) - Personal overrides
 * 3. project (20) - Team settings
 * 4. user (10) - Global defaults
 *
 * Merge rules:
 * - permissions.allow/deny: Combined from all scopes, deny takes precedence
 * - mcpServers: Deep merge by server name, higher priority wins
 * - env: Key-level merge, higher priority wins
 * - Simple values (model, etc.): Higher priority wins
 */

import type {
  AllSettingsResponse,
  ClaudeCodeSettings,
  PermissionsConfig,
  MCPServerConfig,
  SettingsScope,
} from "@/types/claudeSettings";
import { SCOPE_PRIORITY } from "@/types/claudeSettings";

// ============================================================================
// Types for Merged Settings
// ============================================================================

/**
 * Tracks the source scope of a merged value
 */
export interface MergedValue<T> {
  /** The effective value after merging */
  value: T;
  /** The scope this value comes from */
  source: SettingsScope;
  /** Scopes that were overridden */
  overriddenBy?: SettingsScope[];
}

/**
 * Permission entry with source tracking
 */
export interface MergedPermission {
  /** Permission pattern */
  pattern: string;
  /** Source scope */
  source: SettingsScope;
}

/**
 * Merged permissions with source tracking
 */
export interface MergedPermissions {
  /** Combined allow rules with sources */
  allow: MergedPermission[];
  /** Combined deny rules with sources (these take precedence) */
  deny: MergedPermission[];
  /** Combined ask rules with sources */
  ask: MergedPermission[];
  /** Default permission mode with source tracking */
  defaultMode: MergedValue<string | undefined>;
  /** Combined additional directories with sources */
  additionalDirectories: MergedPermission[];
}

/**
 * MCP server with source tracking
 */
export interface MergedMCPServer {
  /** Server configuration */
  config: MCPServerConfig;
  /** Source scope */
  source: SettingsScope;
  /** True if overridden by a higher priority scope */
  isOverridden?: boolean;
  /** Alternative configs from other scopes */
  alternatives?: Array<{
    source: SettingsScope;
    config: MCPServerConfig;
  }>;
}

/**
 * Environment variable with source tracking
 */
export interface MergedEnvVar {
  /** Variable value */
  value: string;
  /** Source scope */
  source: SettingsScope;
  /** Scopes that were overridden */
  overriddenScopes?: SettingsScope[];
}

/**
 * Fully merged settings with source tracking for each value
 */
export interface MergedSettings {
  /** Model setting */
  model: MergedValue<string | undefined>;
  /** Custom API key acknowledgement */
  customApiKeyResponsibleUseAcknowledged: MergedValue<boolean | undefined>;
  /** Language setting */
  language: MergedValue<string | undefined>;
  /** Output style setting */
  outputStyle: MergedValue<string | undefined>;
  /** Cleanup period in days */
  cleanupPeriodDays: MergedValue<number | undefined>;
  /** Respect gitignore setting */
  respectGitignore: MergedValue<boolean | undefined>;
  /** Disable bypass permissions mode setting */
  disableBypassPermissionsMode: MergedValue<"disable" | undefined>;
  /** Merged permissions */
  permissions: MergedPermissions;
  /** Merged MCP servers */
  mcpServers: Record<string, MergedMCPServer>;
  /** Merged environment variables */
  env: Record<string, MergedEnvVar>;
  /** Raw merged settings (without source tracking) */
  effective: ClaudeCodeSettings;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse settings JSON safely
 */
function parseSettings(json: string | null): ClaudeCodeSettings | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ClaudeCodeSettings;
  } catch {
    return null;
  }
}



// ============================================================================
// Merge Functions
// ============================================================================

/**
 * Merge a simple value from multiple scopes
 * Higher priority scope wins
 */
function mergeSimpleValue<T>(
  scopeSettings: Array<{ scope: SettingsScope; settings: ClaudeCodeSettings | null }>,
  getter: (s: ClaudeCodeSettings) => T | undefined
): MergedValue<T | undefined> {
  // Iterate from highest to lowest priority
  const sortedScopes = [...scopeSettings].sort(
    (a, b) => SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope]
  );

  const overriddenScopes: SettingsScope[] = [];
  let effectiveValue: T | undefined;
  let effectiveSource: SettingsScope | undefined;

  for (const { scope, settings } of sortedScopes) {
    if (!settings) continue;
    const value = getter(settings);
    if (value !== undefined) {
      if (effectiveValue === undefined) {
        effectiveValue = value;
        effectiveSource = scope;
      } else {
        overriddenScopes.push(scope);
      }
    }
  }

  return {
    value: effectiveValue,
    source: effectiveSource ?? "user",
    overriddenBy: overriddenScopes.length > 0 ? overriddenScopes : undefined,
  };
}

/**
 * Merge permissions from all scopes
 * Rules are combined, deny takes precedence during evaluation
 */
function mergePermissions(
  scopeSettings: Array<{ scope: SettingsScope; settings: ClaudeCodeSettings | null }>
): MergedPermissions {
  const allow: MergedPermission[] = [];
  const deny: MergedPermission[] = [];
  const ask: MergedPermission[] = [];
  const additionalDirectories: MergedPermission[] = [];

  // Collect from all scopes (order doesn't matter for collection, only for evaluation)
  for (const { scope, settings } of scopeSettings) {
    if (!settings?.permissions) continue;

    settings.permissions.allow?.forEach((pattern) => {
      allow.push({ pattern, source: scope });
    });

    settings.permissions.deny?.forEach((pattern) => {
      deny.push({ pattern, source: scope });
    });

    settings.permissions.ask?.forEach((pattern) => {
      ask.push({ pattern, source: scope });
    });

    settings.permissions.additionalDirectories?.forEach((pattern) => {
      additionalDirectories.push({ pattern, source: scope });
    });
  }

  // Merge defaultMode using simple value merge
  const defaultMode = mergeSimpleValue(scopeSettings, (s) => s.permissions?.defaultMode);

  return { allow, deny, ask, defaultMode, additionalDirectories };
}

/**
 * Merge MCP servers from all scopes
 * Same server name: higher priority scope wins
 */
function mergeMCPServers(
  scopeSettings: Array<{ scope: SettingsScope; settings: ClaudeCodeSettings | null }>
): Record<string, MergedMCPServer> {
  const result: Record<string, MergedMCPServer> = {};
  const serverSources: Record<string, Array<{ scope: SettingsScope; config: MCPServerConfig }>> = {};

  // Collect all servers from all scopes
  for (const { scope, settings } of scopeSettings) {
    if (!settings?.mcpServers) continue;

    for (const [name, config] of Object.entries(settings.mcpServers)) {
      if (!serverSources[name]) {
        serverSources[name] = [];
      }
      serverSources[name].push({ scope, config });
    }
  }

  // For each server, pick the highest priority source
  for (const [name, sources] of Object.entries(serverSources)) {
    const sorted = [...sources].sort(
      (a, b) => SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope]
    );

    const primary = sorted[0];
    if (!primary) continue;

    const alternatives = sorted.slice(1).map(({ scope, config }) => ({
      source: scope,
      config,
    }));

    result[name] = {
      config: primary.config,
      source: primary.scope,
      isOverridden: alternatives.length > 0,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
    };
  }

  return result;
}

/**
 * Merge environment variables from all scopes
 * Same key: higher priority scope wins
 */
function mergeEnvVars(
  scopeSettings: Array<{ scope: SettingsScope; settings: ClaudeCodeSettings | null }>
): Record<string, MergedEnvVar> {
  const result: Record<string, MergedEnvVar> = {};
  const varSources: Record<string, Array<{ scope: SettingsScope; value: string }>> = {};

  // Collect all env vars from all scopes
  for (const { scope, settings } of scopeSettings) {
    if (!settings?.env) continue;

    for (const [key, value] of Object.entries(settings.env)) {
      if (!varSources[key]) {
        varSources[key] = [];
      }
      varSources[key].push({ scope, value });
    }
  }

  // For each var, pick the highest priority source
  for (const [key, sources] of Object.entries(varSources)) {
    const sorted = [...sources].sort(
      (a, b) => SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope]
    );

    const primary = sorted[0];
    if (!primary) continue;

    const overriddenScopes = sorted.slice(1).map((s) => s.scope);

    result[key] = {
      value: primary.value,
      source: primary.scope,
      overriddenScopes: overriddenScopes.length > 0 ? overriddenScopes : undefined,
    };
  }

  return result;
}

/**
 * Create effective settings (without source tracking)
 */
function createEffectiveSettings(merged: Omit<MergedSettings, "effective">): ClaudeCodeSettings {
  const effective: ClaudeCodeSettings = {};

  // Model
  if (merged.model.value !== undefined) {
    effective.model = merged.model.value as ClaudeCodeSettings["model"];
  }

  // Custom API key acknowledgement
  if (merged.customApiKeyResponsibleUseAcknowledged.value !== undefined) {
    effective.customApiKeyResponsibleUseAcknowledged =
      merged.customApiKeyResponsibleUseAcknowledged.value;
  }

  // Language
  if (merged.language.value !== undefined) {
    effective.language = merged.language.value;
  }

  // Output style
  if (merged.outputStyle.value !== undefined) {
    effective.outputStyle = merged.outputStyle.value;
  }

  // Cleanup period
  if (merged.cleanupPeriodDays.value !== undefined) {
    effective.cleanupPeriodDays = merged.cleanupPeriodDays.value;
  }

  // Respect gitignore
  if (merged.respectGitignore.value !== undefined) {
    effective.respectGitignore = merged.respectGitignore.value;
  }

  // Permissions
  const permissions: PermissionsConfig = {};
  if (merged.permissions.allow.length > 0) {
    permissions.allow = merged.permissions.allow.map((p) => p.pattern);
  }
  if (merged.permissions.deny.length > 0) {
    permissions.deny = merged.permissions.deny.map((p) => p.pattern);
  }
  if (merged.permissions.ask.length > 0) {
    permissions.ask = merged.permissions.ask.map((p) => p.pattern);
  }
  if (merged.permissions.additionalDirectories.length > 0) {
    permissions.additionalDirectories = merged.permissions.additionalDirectories.map((p) => p.pattern);
  }
  if (merged.permissions.defaultMode.value !== undefined) {
    permissions.defaultMode = merged.permissions.defaultMode.value as PermissionsConfig["defaultMode"];
  }
  if (merged.disableBypassPermissionsMode.value !== undefined) {
    permissions.disableBypassPermissionsMode = merged.disableBypassPermissionsMode.value;
  }
  if (Object.keys(permissions).length > 0) {
    effective.permissions = permissions;
  }

  // MCP Servers
  if (Object.keys(merged.mcpServers).length > 0) {
    effective.mcpServers = Object.fromEntries(
      Object.entries(merged.mcpServers).map(([name, { config }]) => [name, config])
    );
  }

  // Environment variables
  if (Object.keys(merged.env).length > 0) {
    effective.env = Object.fromEntries(
      Object.entries(merged.env).map(([key, { value }]) => [key, value])
    );
  }

  return effective;
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Merge settings from all scopes according to Claude Code precedence rules
 *
 * @param allSettings - Raw settings JSON from all scopes
 * @returns Merged settings with source tracking
 */
export function mergeSettings(allSettings: AllSettingsResponse): MergedSettings {
  // Parse all settings
  const scopeSettings: Array<{ scope: SettingsScope; settings: ClaudeCodeSettings | null }> = [
    { scope: "user", settings: parseSettings(allSettings.user) },
    { scope: "project", settings: parseSettings(allSettings.project) },
    { scope: "local", settings: parseSettings(allSettings.local) },
    { scope: "managed", settings: parseSettings(allSettings.managed) },
  ];

  // Merge each category
  const model = mergeSimpleValue(scopeSettings, (s) => s.model);
  const customApiKeyResponsibleUseAcknowledged = mergeSimpleValue(
    scopeSettings,
    (s) => s.customApiKeyResponsibleUseAcknowledged
  );
  const language = mergeSimpleValue(scopeSettings, (s) => s.language);
  const outputStyle = mergeSimpleValue(scopeSettings, (s) => s.outputStyle);
  const cleanupPeriodDays = mergeSimpleValue(scopeSettings, (s) => s.cleanupPeriodDays);
  const respectGitignore = mergeSimpleValue(scopeSettings, (s) => s.respectGitignore);
  const disableBypassPermissionsMode = mergeSimpleValue(
    scopeSettings,
    (s) => s.permissions?.disableBypassPermissionsMode
  );
  const permissions = mergePermissions(scopeSettings);
  const mcpServers = mergeMCPServers(scopeSettings);
  const env = mergeEnvVars(scopeSettings);

  const partialMerged = {
    model,
    customApiKeyResponsibleUseAcknowledged,
    language,
    outputStyle,
    cleanupPeriodDays,
    respectGitignore,
    disableBypassPermissionsMode,
    permissions,
    mcpServers,
    env,
  };

  return {
    ...partialMerged,
    effective: createEffectiveSettings(partialMerged),
  };
}

/**
 * Get total count of MCP servers across all scopes
 */
export function getTotalMCPServerCount(merged: MergedSettings): number {
  return Object.keys(merged.mcpServers).length;
}

/**
 * Get servers that have conflicts (same name in multiple scopes)
 */
export function getConflictingServers(
  merged: MergedSettings
): Array<{ name: string; sources: SettingsScope[] }> {
  return Object.entries(merged.mcpServers)
    .filter(([, server]) => server.alternatives && server.alternatives.length > 0)
    .map(([name, server]) => ({
      name,
      sources: [server.source, ...(server.alternatives?.map((a) => a.source) ?? [])],
    }));
}
