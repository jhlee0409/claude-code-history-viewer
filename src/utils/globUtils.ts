/**
 * Glob Pattern Matching Utilities
 *
 * Safe glob pattern matching with ReDoS protection.
 */

/**
 * Maximum pattern length to prevent ReDoS attacks
 */
const MAX_PATTERN_LENGTH = 256;

/**
 * Maximum number of wildcards to prevent catastrophic backtracking
 */
const MAX_WILDCARDS = 10;

/**
 * Match a text string against a glob pattern.
 * Supports * (any characters) and ? (single character) wildcards.
 *
 * @param text - The text to match against
 * @param pattern - The glob pattern (supports * and ?)
 * @returns true if the text matches the pattern
 *
 * @example
 * matchGlobPattern("folders-dg-abc123", "folders-dg-*") // true
 * matchGlobPattern("test.ts", "*.ts") // true
 * matchGlobPattern("abc", "a?c") // true
 */
export const matchGlobPattern = (text: string, pattern: string): boolean => {
  // Safety check: limit pattern length to prevent ReDoS
  if (pattern.length > MAX_PATTERN_LENGTH) {
    console.warn(
      `Glob pattern exceeds maximum length (${MAX_PATTERN_LENGTH}), skipping`
    );
    return false;
  }

  // Safety check: limit number of wildcards to prevent catastrophic backtracking
  const wildcardCount = (pattern.match(/[*?]/g) || []).length;
  if (wildcardCount > MAX_WILDCARDS) {
    console.warn(
      `Glob pattern has too many wildcards (${wildcardCount} > ${MAX_WILDCARDS}), skipping`
    );
    return false;
  }

  // Convert glob pattern to regex
  // Use placeholders to avoid replacement conflicts (e.g., * -> .*? then ? -> . would break .*?)
  const STAR_PLACEHOLDER = "\x00STAR\x00";
  const QUESTION_PLACEHOLDER = "\x00QUESTION\x00";

  const regexPattern = pattern
    .replace(/\*/g, STAR_PLACEHOLDER) // Temporarily replace *
    .replace(/\?/g, QUESTION_PLACEHOLDER) // Temporarily replace ?
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(new RegExp(STAR_PLACEHOLDER, "g"), ".*") // * -> .* (greedy is fine with anchors)
    .replace(new RegExp(QUESTION_PLACEHOLDER, "g"), "."); // ? -> .

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  } catch {
    // Invalid regex pattern
    return false;
  }
};
