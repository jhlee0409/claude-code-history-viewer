/**
 * Path Utilities
 *
 * Helper functions for formatting and manipulating file paths.
 */

/**
 * Detect home directory from paths (infer from /Users/xxx, /home/xxx, or C:\Users\xxx patterns)
 */
export function detectHomeDir(paths: string[]): string | null {
  for (const path of paths) {
    // macOS: /Users/username/...
    const macMatch = path.match(/^(\/Users\/[^/]+)/);
    if (macMatch?.[1]) return macMatch[1];

    // Linux: /home/username/...
    const linuxMatch = path.match(/^(\/home\/[^/]+)/);
    if (linuxMatch?.[1]) return linuxMatch[1];

    // Windows: C:\Users\username\... (case-insensitive)
    const windowsMatch = path.match(/^([A-Za-z]:\\Users\\[^\\]+)/i);
    if (windowsMatch?.[1]) return windowsMatch[1];
  }
  return null;
}

/**
 * Format path for display (replace home dir with ~/)
 */
export function formatDisplayPath(path: string, homeDir: string | null): string {
  if (homeDir && path.startsWith(homeDir)) {
    const relativePath = path.slice(homeDir.length);
    return relativePath ? `~${relativePath}` : "~";
  }
  return path;
}

/**
 * Format path with automatic home directory detection
 */
export function formatPathWithTilde(path: string, allPaths?: string[]): string {
  const homeDir = allPaths ? detectHomeDir(allPaths) : detectHomeDir([path]);
  return formatDisplayPath(path, homeDir);
}
