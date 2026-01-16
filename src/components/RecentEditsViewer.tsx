"use client";

import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  FileEdit,
  FilePlus,
  Clock,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  File,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { useTheme } from "@/contexts/theme";
import type { RecentEditsResult, RecentFileEdit } from "../types";
import { COLORS } from "../constants/colors";
import { cn } from "../utils/cn";

interface RecentEditsViewerProps {
  recentEdits: RecentEditsResult | null;
  isLoading?: boolean;
  error?: string | null;
}

// Helper function to get file extension language for syntax highlighting
const getLanguageFromPath = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase();
  const fileName = path.split("/").pop()?.toLowerCase() || "";

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

// Helper function to format timestamp
const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
};

// Helper function to get relative time
const getRelativeTime = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
};

// Individual file edit item component
const FileEditItem: React.FC<{
  edit: RecentFileEdit;
  isDarkMode: boolean;
}> = ({ edit, isDarkMode }) => {
  const { t } = useTranslation("components");
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const language = getLanguageFromPath(edit.file_path);
  const fileName = edit.file_path.split("/").pop() || edit.file_path;
  const lines = edit.content_after_change.split("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(edit.content_after_change);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleRestore = async () => {
    try {
      setRestoreStatus('loading');
      await invoke("restore_file", {
        filePath: edit.file_path,
        content: edit.content_after_change,
      });
      setRestoreStatus('success');
      setTimeout(() => setRestoreStatus('idle'), 2000);
    } catch (err) {
      console.error("Failed to restore file:", err);
      setRestoreStatus('error');
      setTimeout(() => setRestoreStatus('idle'), 3000);
    }
  };

  return (
    <div
      className={cn(
        "border rounded-lg overflow-hidden transition-all",
        COLORS.ui.border.light,
        COLORS.ui.background.secondary
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between p-3 cursor-pointer hover:bg-opacity-80 transition-colors",
          edit.operation_type === "write"
            ? "bg-green-50 dark:bg-green-950/30"
            : "bg-blue-50 dark:bg-blue-950/30"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          {/* Expand/Collapse icon */}
          {isExpanded ? (
            <ChevronDown className={cn("w-4 h-4 shrink-0", COLORS.ui.text.muted)} />
          ) : (
            <ChevronRight className={cn("w-4 h-4 shrink-0", COLORS.ui.text.muted)} />
          )}

          {/* Operation type icon */}
          {edit.operation_type === "write" ? (
            <FilePlus className={cn("w-4 h-4 shrink-0", COLORS.semantic.success.icon)} />
          ) : (
            <FileEdit className={cn("w-4 h-4 shrink-0", COLORS.semantic.info.icon)} />
          )}

          {/* File name and path */}
          <div className="min-w-0 flex-1">
            <div className={cn("font-medium truncate", COLORS.ui.text.primary)}>
              {fileName}
            </div>
            <div className={cn("text-xs truncate", COLORS.ui.text.muted)}>
              {edit.file_path}
            </div>
          </div>
        </div>

        {/* Right side info */}
        <div className="flex items-center space-x-3 shrink-0 ml-2">
          {/* Diff stats */}
          <div className="flex items-center space-x-2 text-xs">
            {edit.lines_added > 0 && (
              <span className="text-green-600 dark:text-green-400">
                +{edit.lines_added}
              </span>
            )}
            {edit.lines_removed > 0 && (
              <span className="text-red-600 dark:text-red-400">
                -{edit.lines_removed}
              </span>
            )}
          </div>

          {/* Operation badge */}
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              edit.operation_type === "write"
                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            )}
          >
            {edit.operation_type === "write"
              ? t("recentEdits.created")
              : t("recentEdits.edited")}
          </span>

          {/* Timestamp */}
          <div className={cn("flex items-center space-x-1 text-xs", COLORS.ui.text.muted)}>
            <Clock className="w-3 h-3" />
            <span title={formatTimestamp(edit.timestamp)}>
              {getRelativeTime(edit.timestamp)}
            </span>
          </div>

          {/* Copy button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              copied
                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                : "hover:bg-gray-200 dark:hover:bg-gray-700"
            )}
            title={t("recentEdits.copyContent")}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Restore button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (restoreStatus === 'idle') {
                handleRestore();
              }
            }}
            disabled={restoreStatus === 'loading'}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              restoreStatus === 'success'
                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                : restoreStatus === 'error'
                ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                : restoreStatus === 'loading'
                ? "bg-gray-100 dark:bg-gray-800 cursor-wait"
                : "hover:bg-gray-200 dark:hover:bg-gray-700"
            )}
            title={t("recentEdits.restoreFile")}
          >
            {restoreStatus === 'loading' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : restoreStatus === 'success' ? (
              <Check className="w-4 h-4" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className={cn("border-t", COLORS.ui.border.light)}>
          {/* Code content */}
          <div className="max-h-96 overflow-auto">
            <Highlight
              theme={isDarkMode ? themes.vsDark : themes.vsLight}
              code={edit.content_after_change}
              language={
                language === "tsx"
                  ? "typescript"
                  : language === "jsx"
                  ? "javascript"
                  : language
              }
            >
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={className}
                  style={{
                    ...style,
                    margin: 0,
                    fontSize: "0.75rem",
                    lineHeight: "1.25rem",
                    padding: "0.75rem",
                  }}
                >
                  {tokens.map((line, i) => (
                    <div
                      key={i}
                      {...getLineProps({ line, key: i })}
                      style={{ display: "table-row" }}
                    >
                      <span
                        style={{
                          display: "table-cell",
                          textAlign: "right",
                          paddingRight: "1em",
                          userSelect: "none",
                          opacity: 0.5,
                          width: "3em",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ display: "table-cell" }}>
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token, key })} />
                        ))}
                      </span>
                    </div>
                  ))}
                </pre>
              )}
            </Highlight>
          </div>

          {/* Footer with stats */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-2 text-xs border-t",
              COLORS.ui.border.light,
              COLORS.ui.background.secondary
            )}
          >
            <div className={cn("flex items-center space-x-4", COLORS.ui.text.muted)}>
              <span>{lines.length} {t("recentEdits.lines")}</span>
              <span>{language}</span>
            </div>
            <div className={cn(COLORS.ui.text.muted)}>
              {formatTimestamp(edit.timestamp)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const RecentEditsViewer: React.FC<RecentEditsViewerProps> = ({
  recentEdits,
  isLoading = false,
  error = null,
}) => {
  const { t } = useTranslation("components");
  const { isDarkMode } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter files by search query
  const filteredFiles = useMemo(() => {
    if (!recentEdits?.files) return [];
    if (!searchQuery.trim()) return recentEdits.files;

    const query = searchQuery.toLowerCase();
    return recentEdits.files.filter(
      (file) =>
        file.file_path.toLowerCase().includes(query) ||
        file.content_after_change.toLowerCase().includes(query)
    );
  }, [recentEdits?.files, searchQuery]);

  // Calculate stats based on filtered results
  const stats = useMemo(() => {
    const files = filteredFiles;
    const uniqueFilePaths = new Set(files.map(f => f.file_path));
    return {
      uniqueFilesCount: uniqueFilePaths.size,
      totalEditsCount: files.length,
    };
  }, [filteredFiles]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className={cn("w-8 h-8 animate-spin mb-4", COLORS.ui.text.muted)} />
        <p className={cn("text-sm", COLORS.ui.text.muted)}>
          {t("recentEdits.loading")}
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className={cn("text-sm", COLORS.semantic.error.text)}>{error}</div>
      </div>
    );
  }

  // Empty state
  if (!recentEdits || recentEdits.files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <File className={cn("w-12 h-12 mb-4", COLORS.ui.text.disabledDark)} />
        <p className={cn("text-lg mb-2", COLORS.ui.text.muted)}>
          {t("recentEdits.noEdits")}
        </p>
        <p className={cn("text-sm", COLORS.ui.text.muted)}>
          {t("recentEdits.noEditsDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header with stats */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className={cn("text-lg font-semibold", COLORS.ui.text.primary)}>
            {t("recentEdits.title")}
          </h2>
          <div className={cn("text-sm", COLORS.ui.text.muted)}>
            {t("recentEdits.stats", {
              files: stats.uniqueFilesCount,
              edits: stats.totalEditsCount,
            })}
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search
            className={cn(
              "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4",
              COLORS.ui.text.muted
            )}
          />
          <input
            type="text"
            placeholder={t("recentEdits.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full pl-10 pr-4 py-2 rounded-lg border text-sm",
              COLORS.ui.border.light,
              COLORS.ui.background.primary,
              COLORS.ui.text.primary,
              "focus:outline-none focus:ring-2 focus:ring-blue-500"
            )}
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto space-y-2">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <p className={cn("text-sm", COLORS.ui.text.muted)}>
              {t("recentEdits.noSearchResults")}
            </p>
          </div>
        ) : (
          filteredFiles.map((edit, index) => (
            <FileEditItem key={`${edit.file_path}-${index}`} edit={edit} isDarkMode={isDarkMode} />
          ))
        )}
      </div>

      {/* Footer info */}
      <div
        className={cn(
          "mt-4 pt-4 border-t text-xs",
          COLORS.ui.border.light,
          COLORS.ui.text.muted
        )}
      >
        {t("recentEdits.footerInfo")}
      </div>
    </div>
  );
};
