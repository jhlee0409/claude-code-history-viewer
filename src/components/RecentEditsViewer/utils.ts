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
 * Clock time (`14:22`) for the chronological, per-edit grouping.
 *
 * A stream of edits needs ordering more than recency, and `2 hours ago` on
 * every row of a session that ran two hours ago tells you nothing about
 * sequence.
 */
export const formatClockTime = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

/**
 * Compact relative time (`3m`, `14h`, `2d`) for the per-file grouping.
 *
 * The long form from `getRelativeTime` does not fit the compact row, where the
 * whole meta column is about 60px.
 */
export const getCompactRelativeTime = (
  timestamp: string,
  t: (key: string, defaultValue: string, options?: { count: number }) => string
): string => {
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";

    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("recentEdits.timeNowShort", "now");
    if (diffMins < 60)
      return t("recentEdits.timeMinutesShort", "{{count}}m", {
        count: diffMins,
      });
    if (diffHours < 24)
      return t("recentEdits.timeHoursShort", "{{count}}h", {
        count: diffHours,
      });
    if (diffDays < 7)
      return t("recentEdits.timeDaysShort", "{{count}}d", { count: diffDays });
    return date.toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
    });
  } catch {
    return "";
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
