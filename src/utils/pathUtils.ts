/**
 * Path Utilities
 *
 * Helper functions for formatting and manipulating file paths.
 */

/**
 * Check if a path is absolute (Unix or Windows)
 * - Unix: starts with /
 * - Windows: starts with drive letter (e.g., C:\)
 */
export function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/)/.test(path);
}

/**
 * Detect home directory from paths (infer from /Users/xxx, /home/xxx, or Windows Users paths)
 */
export function detectHomeDir(paths: string[]): string | null {
  for (const path of paths) {
    // macOS: /Users/username/...
    const macMatch = path.match(/^(\/Users\/[^/]+)/);
    if (macMatch?.[1]) return macMatch[1];

    // Linux: /home/username/...
    const linuxMatch = path.match(/^(\/home\/[^/]+)/);
    if (linuxMatch?.[1]) return linuxMatch[1];

    // Windows: C:\Users\username\... or C:/Users/username/... (case-insensitive)
    const windowsMatch = path.match(/^(\/?[A-Za-z]:[\\/]Users[\\/][^\\/]+)/i);
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

/**
 * Split a local filesystem path into non-empty parts.
 */
export function splitPathParts(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/**
 * Return the final folder/file name from a path-like string.
 */
export function getPathLeaf(path: string): string {
  const parts = splitPathParts(path);
  return parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
}

/**
 * Return user-facing path parts for compact sidebar display.
 */
export function getDisplayPathParts(path: string): string[] {
  const normalized = path.replace(/\\/g, "/");
  const iCloudMarker = "/Library/Mobile Documents/com~apple~CloudDocs";
  const iCloudIndex = normalized.indexOf(iCloudMarker);

  if (iCloudIndex >= 0) {
    const afterICloud = normalized.slice(iCloudIndex + iCloudMarker.length);
    return ["iCloud Drive", ...splitPathParts(afterICloud)];
  }

  const normalizedHomeDir = detectHomeDir([path])?.replace(/\\+/g, "/");
  if (normalizedHomeDir && normalized.startsWith(normalizedHomeDir)) {
    const relativePath = normalized.slice(normalizedHomeDir.length);
    return relativePath ? ["~", ...splitPathParts(relativePath)] : ["~"];
  }

  const withoutDrivePrefix = normalized.replace(/^[A-Za-z]:(?=\/|$)/, "");
  return splitPathParts(withoutDrivePrefix);
}

/**
 * Return a short parent path suitable for secondary text under a leaf label.
 */
export function getCompactParentPath(path: string, maxParts = 3): string {
  const parts = getDisplayPathParts(path);
  if (parts.length <= 1) return "";

  const parentParts = parts.slice(0, -1);
  const visibleParent = parentParts.slice(-maxParts).join(" / ");
  const prefix = parentParts.length > maxParts ? "... / " : "";
  return `${prefix}${visibleParent}`;
}
