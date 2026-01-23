/**
 * RecentEditsViewer Utility Functions
 */

/**
 * Get the syntax highlighting language from a file path
 */
export const getLanguageFromPath = (path: string): string => {
  const normalizedPath = path.replace(/\\/g, "/");
  const ext = normalizedPath.split(".").pop()?.toLowerCase();
  const fileName = normalizedPath.split("/").pop()?.toLowerCase() || "";

  switch (ext) {
    case "rs":
      return "rust";
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "py":
      return "python";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "html":
    case "htm":
      return "html";
    case "yaml":
    case "yml":
      return "yaml";
    case "sh":
    case "zsh":
    case "bash":
      return "bash";
    case "go":
      return "go";
    case "java":
      return "java";
    case "swift":
      return "swift";
    case "kt":
    case "kotlin":
      return "kotlin";
    case "rb":
      return "ruby";
    case "toml":
      return "toml";
    default:
      if (fileName.includes("dockerfile")) return "dockerfile";
      if (fileName.includes("makefile")) return "makefile";
      return "text";
  }
};

/**
 * Format a timestamp to locale string
 */
export const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
};

/**
 * Get relative time string with i18n support
 */
export const getRelativeTime = (
  timestamp: string,
  t: (key: string, options?: { count: number }) => string
): string => {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("common.time.justNow");
    if (diffMins < 60) return t("common.time.minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("common.time.hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("common.time.daysAgo", { count: diffDays });
    return date.toLocaleDateString();
  } catch {
    return "";
  }
};
