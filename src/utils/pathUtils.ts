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
 * A project can remain browsable even when its last-known working directory
 * has been removed (for example, an ephemeral Git worktree).
 */
export function isProjectPathUnavailable(project: {
  path_status?: string;
} | null | undefined): boolean {
  return project?.path_status === "unavailable";
}

// OS scratch locations. Sessions started there (agent sandboxes, one-off
// translation jobs, `mktemp -d` experiments) are rarely what the user is
// looking for and would otherwise bury real projects in the explorer.
const TEMP_PATH_PATTERNS: RegExp[] = [
  /^\/(?:private\/)?tmp(?:\/|$)/,
  /^\/(?:private\/)?var\/(?:folders|tmp)(?:\/|$)/,
  /^\/dev\/shm(?:\/|$)/,
  /^\/Users\/[^/]+\/Library\/Caches(?:\/|$)/,
  /^\/home\/[^/]+\/\.cache(?:\/|$)/,
  /^\/?[A-Za-z]:[\\/]Users[\\/][^\\/]+[\\/]AppData[\\/]Local[\\/]Temp(?:[\\/]|$)/i,
  /^\/?[A-Za-z]:[\\/]Windows[\\/]Temp(?:[\\/]|$)/i,
];

/** Whether `path` lives under an OS temporary/cache directory. */
export function isTemporaryPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return TEMP_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/** Available project whose working directory is an OS scratch location. */
export function isProjectTemporary(project: {
  actual_path?: string;
  path_status?: string;
} | null | undefined): boolean {
  return !isProjectPathUnavailable(project) && isTemporaryPath(project?.actual_path);
}

/**
 * Human label for a project row. Providers that name projects after the
 * encoded store directory (`-Users-jack-client-foo`) or an absolute path get
 * the leaf of the real working directory instead.
 */
export function getProjectDisplayName(project: {
  name: string;
  path: string;
  actual_path?: string;
  provider?: string | null;
}): string {
  const actualPath = project.actual_path || project.path || project.name;
  const preferPathLeaf =
    (project.provider ?? "claude") === "claude" ||
    project.name === project.path ||
    project.name === actualPath ||
    isAbsolutePath(project.name) ||
    project.name.startsWith("-");
  return preferPathLeaf ? getPathLeaf(actualPath) || project.name : project.name;
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

/** `\\?\C:\x` and `C:\x` name the same file; the prefix is a Win32 API escape. */
function stripExtendedLengthPrefix(path: string): string {
  // The extended UNC form names the same share as the plain UNC form, so it
  // has to become a UNC path again rather than the bare `UNC/server...` that
  // stripping the generic prefix alone would leave.
  const unc = path.replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, "\\\\");
  if (unc !== path) return unc;
  return path.replace(/^[\\/]{2}\?[\\/]/, "");
}

/** A UNC path (`\\server\share`) has a different root kind from `C:\` or `/`. */
function isUncPath(path: string): boolean {
  return /^[\\/]{2}[^\\/]/.test(path);
}

/**
 * Whether a path should be compared case-insensitively.
 *
 * Windows paths are case-insensitive, and the backend applies exactly that rule
 * when filtering edits to the project directory (`edits.rs:465`, gated on
 * `target_os = "windows"`). The frontend cannot read that cfg flag, so it infers
 * the platform from the shape of the path instead. POSIX paths stay
 * case-sensitive, where two files genuinely can differ only by case.
 */
function isWindowsStylePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
}

/**
 * Strip the project root off a file path, for compact display.
 *
 * Returns the remainder joined with forward slashes, so
 * `E:\Projects\my-app\skills\deliver-prd\TEMPLATE.md` under root
 * `E:\Projects\my-app` becomes `skills/deliver-prd/TEMPLATE.md`.
 *
 * Returns the path unchanged when there is no root to strip or the path does not
 * sit under it, and an empty string when the path *is* the root.
 *
 * Comparison is segment-wise rather than a plain `startsWith`, so a sibling
 * directory that merely shares a name prefix (`.../foobar` against root
 * `.../foo`) is not mistaken for a child.
 */
export function elideProjectRoot(
  filePath: string,
  projectCwd?: string
): string {
  if (!projectCwd) return filePath;

  // Compare like with like. Splitting on separators throws away what kind of
  // root a path had, so a relative `server/share/x` looked like a child of the
  // UNC root for the same names, and an extended-length path looked unrelated
  // to the plain drive path naming the same file.
  const normalizedRoot = stripExtendedLengthPrefix(projectCwd);
  const normalizedPath = stripExtendedLengthPrefix(filePath);

  // Settle the UNC question first and let it answer the absolute one. A UNC
  // path is absolute however it is spelled, but `isAbsolutePath` only
  // recognises the forward-slash spelling, so asking it about `\server` and
  // `//server` reports two different kinds of root for the same share and the
  // comparison below bails. Widening `isAbsolutePath` itself would reach seven
  // call sites, one of them a validation gate in front of a native rename.
  const rootIsUnc = isUncPath(normalizedRoot);
  const pathIsUnc = isUncPath(normalizedPath);
  if (pathIsUnc !== rootIsUnc) {
    return filePath;
  }
  if (
    !pathIsUnc &&
    isAbsolutePath(normalizedPath) !== isAbsolutePath(normalizedRoot)
  ) {
    return filePath;
  }

  const rootParts = splitPathParts(normalizedRoot);
  // A POSIX root of `/` splits to no parts, which is a real root rather than an
  // absent one: bailing out here meant a project rooted at `/` could never
  // elide anything.
  if (rootParts.length === 0 && !isAbsolutePath(normalizedRoot)) {
    return filePath;
  }

  const pathParts = splitPathParts(normalizedPath);
  if (pathParts.length < rootParts.length) return filePath;

  const ignoreCase =
    isWindowsStylePath(projectCwd) || isWindowsStylePath(filePath);
  const matches = (a: string, b: string) =>
    ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;

  for (let i = 0; i < rootParts.length; i += 1) {
    if (!matches(pathParts[i] ?? "", rootParts[i] ?? "")) return filePath;
  }

  return pathParts.slice(rootParts.length).join("/");
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
