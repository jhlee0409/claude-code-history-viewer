/**
 * Security Utilities
 *
 * Utilities for handling sensitive information in the Settings Manager.
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Patterns that indicate a key contains sensitive data.
 * Case-insensitive matching is applied.
 */
export const SENSITIVE_KEY_PATTERNS = [
  "api_key",
  "api-key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "auth",
  "private_key",
  "private-key",
  "access_key",
  "access-key",
] as const;

/**
 * Minimum length before applying partial masking.
 * Values shorter than this are fully masked.
 */
export const MASK_MIN_LENGTH = 8;

/**
 * Default mask string for fully hidden values.
 */
export const FULL_MASK = "••••••••";

// ============================================================================
// Functions
// ============================================================================

/**
 * Check if a key name indicates sensitive data.
 *
 * @param key - The key name to check
 * @returns True if the key likely contains sensitive data
 *
 * @example
 * isSensitiveKey("API_KEY") // true
 * isSensitiveKey("DEBUG") // false
 */
export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));
}

/**
 * Mask a sensitive value for display.
 *
 * - Short values (< 8 chars): Fully masked
 * - Longer values: Shows first 4 and last 4 characters
 *
 * @param value - The value to mask
 * @returns Masked string
 *
 * @example
 * maskValue("short") // "••••••••"
 * maskValue("sk-1234567890abcdef") // "sk-1••••cdef"
 */
export function maskValue(value: string): string {
  if (value.length <= MASK_MIN_LENGTH) {
    return FULL_MASK;
  }
  return value.slice(0, 4) + "••••" + value.slice(-4);
}

/**
 * Conditionally mask a value based on its key.
 *
 * @param key - The key name
 * @param value - The value to potentially mask
 * @returns Original value if key is not sensitive, masked value otherwise
 *
 * @example
 * maskIfSensitive("API_KEY", "sk-123456") // "••••••••"
 * maskIfSensitive("DEBUG", "true") // "true"
 */
export function maskIfSensitive(key: string, value: string): string {
  return isSensitiveKey(key) ? maskValue(value) : value;
}

/**
 * Check if an object contains any sensitive keys.
 *
 * @param obj - Object to check (typically env vars)
 * @returns True if any key matches sensitive patterns
 */
export function hasSensitiveData(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some(isSensitiveKey);
}

/**
 * Count the number of sensitive keys in an object.
 *
 * @param obj - Object to analyze
 * @returns Number of sensitive keys found
 */
export function countSensitiveKeys(obj: Record<string, unknown>): number {
  return Object.keys(obj).filter(isSensitiveKey).length;
}

/**
 * Check if MCP server configs contain any sensitive environment variables.
 *
 * @param servers - MCP server configurations
 * @returns True if any server has sensitive env vars
 */
export function mcpServersHaveSensitiveData(
  servers: Record<string, { env?: Record<string, string> }>
): boolean {
  return Object.values(servers).some(
    (server) => server.env && hasSensitiveData(server.env)
  );
}

/**
 * Get a summary of sensitive data in settings.
 *
 * @param settings - Settings object to analyze
 * @returns Summary of sensitive data found
 */
export function analyzeSensitiveData(settings: {
  env?: Record<string, string>;
  mcpServers?: Record<string, { env?: Record<string, string> }>;
}): {
  hasEnvSecrets: boolean;
  hasMcpSecrets: boolean;
  envSecretCount: number;
  mcpServerWithSecretsCount: number;
} {
  const envSecretCount = settings.env ? countSensitiveKeys(settings.env) : 0;

  let mcpServerWithSecretsCount = 0;
  if (settings.mcpServers) {
    mcpServerWithSecretsCount = Object.values(settings.mcpServers).filter(
      (server) => server.env && hasSensitiveData(server.env)
    ).length;
  }

  return {
    hasEnvSecrets: envSecretCount > 0,
    hasMcpSecrets: mcpServerWithSecretsCount > 0,
    envSecretCount,
    mcpServerWithSecretsCount,
  };
}
