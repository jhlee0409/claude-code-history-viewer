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
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";

interface RecentEditsViewerProps {
  recentEdits: RecentEditsResult | null;
  isLoading?: boolean;
  error?: string | null;
}

// Helper function to get file extension language for syntax highlighting
const getLanguageFromPath = (path: string): string => {
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

// Helper function to format timestamp
const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
};

// Helper function to get relative time with i18n support
const getRelativeTime = (
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

    if (diffMins < 1) return t("time.justNow");
    if (diffMins < 60) return t("time.minutesAgo", { count: diffMins });
    if (diffHours < 24) return t("time.hoursAgo", { count: diffHours });
    if (diffDays < 7) return t("time.daysAgo", { count: diffDays });
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
  const { t: tCommon } = useTranslation("common");
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const language = getLanguageFromPath(edit.file_path);
  const fileName = edit.file_path.replace(/\\/g, "/").split("/").pop() || edit.file_path;
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

  const handleRestoreClick = () => {
    setShowConfirmDialog(true);
  };

  const handleRestoreConfirm = async () => {
    setShowConfirmDialog(false);
    setErrorMessage(null);
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
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setRestoreStatus('error');
      setTimeout(() => {
        setRestoreStatus('idle');
        setErrorMessage(null);
      }, 5000);
    }
  };

  const handleRestoreCancel = () => {
    setShowConfirmDialog(false);
  };

  return (
    <div className="border-2 rounded-xl overflow-hidden transition-all duration-300 border-border bg-card hover:border-accent/30 hover:shadow-md">
      {/* Header */}
      <div
        className={cn(
          "relative flex items-center justify-between p-4 cursor-pointer transition-all duration-300",
          edit.operation_type === "write"
            ? "bg-gradient-to-r from-green-50 to-emerald-50/50 dark:from-green-950/40 dark:to-emerald-950/20"
            : "bg-gradient-to-r from-blue-50 to-indigo-50/50 dark:from-blue-950/40 dark:to-indigo-950/20",
          isExpanded && "border-b border-border"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Left accent bar */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1",
            edit.operation_type === "write" ? "bg-success" : "bg-info"
          )}
        />

        <div className="flex items-center space-x-3 min-w-0 flex-1">
          {/* Expand/Collapse icon */}
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center transition-all duration-300",
              isExpanded ? "bg-accent/20 text-accent" : "bg-muted/50 text-muted-foreground"
            )}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>

          {/* Operation type icon */}
          <div
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              edit.operation_type === "write"
                ? "bg-success/20 text-success"
                : "bg-info/20 text-info"
            )}
          >
            {edit.operation_type === "write" ? (
              <FilePlus className="w-4 h-4" />
            ) : (
              <FileEdit className="w-4 h-4" />
            )}
          </div>

          {/* File name and path */}
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate text-foreground">
              {fileName}
            </div>
            <div className={`${layout.smallText} truncate text-muted-foreground mt-0.5`}>
              {edit.file_path}
            </div>
          </div>
        </div>

        {/* Right side info */}
        <div className="flex items-center space-x-3 shrink-0 ml-2">
          {/* Diff stats */}
          <div className={`flex items-center space-x-2 ${layout.smallText} font-mono`}>
            {edit.lines_added > 0 && (
              <span className="text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 rounded">
                +{edit.lines_added}
              </span>
            )}
            {edit.lines_removed > 0 && (
              <span className="text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 rounded">
                -{edit.lines_removed}
              </span>
            )}
          </div>

          {/* Operation badge */}
          <span
            className={cn(
              `${layout.smallText} px-2.5 py-1 rounded-full font-medium`,
              edit.operation_type === "write"
                ? "bg-success/20 text-success ring-1 ring-success/30"
                : "bg-info/20 text-info ring-1 ring-info/30"
            )}
          >
            {edit.operation_type === "write"
              ? t("recentEdits.created")
              : t("recentEdits.edited")}
          </span>

          {/* Timestamp */}
          <div className={`flex items-center space-x-1.5 ${layout.smallText} text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg`}>
            <Clock className="w-3 h-3" />
            <span title={formatTimestamp(edit.timestamp)}>
              {getRelativeTime(edit.timestamp, tCommon)}
            </span>
          </div>

          {/* Copy button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              copied
                ? "bg-success/20 text-success ring-1 ring-success/30"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
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
                handleRestoreClick();
              }
            }}
            disabled={restoreStatus === 'loading'}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              restoreStatus === 'success'
                ? "bg-success/20 text-success ring-1 ring-success/30"
                : restoreStatus === 'error'
                ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30"
                : restoreStatus === 'loading'
                ? "bg-muted text-muted-foreground cursor-wait"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
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

      {/* Error message toast */}
      {errorMessage && (
        <div className={`mx-3 mb-2 p-2 rounded-md bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 ${layout.smallText}`}>
          {t("recentEdits.restoreError")}: {errorMessage}
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirmDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={handleRestoreCancel}
        >
          <div
            className="rounded-lg p-6 max-w-md mx-4 shadow-xl bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2 text-foreground">
              {t("recentEdits.confirmRestoreTitle")}
            </h3>
            <p className={`${layout.bodyText} mb-4 text-muted-foreground`}>
              {t("recentEdits.confirmRestoreMessage", { path: edit.file_path })}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleRestoreCancel}
                className={`px-4 py-2 rounded-md ${layout.bodyText} bg-muted hover:bg-muted/80 text-foreground`}
              >
                {t("recentEdits.cancel")}
              </button>
              <button
                onClick={handleRestoreConfirm}
                className={`px-4 py-2 rounded-md ${layout.bodyText} bg-blue-600 hover:bg-blue-700 text-white`}
              >
                {t("recentEdits.confirmRestore")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border">
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
                    fontSize: "0.8125rem",
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
          <div className={`flex items-center justify-between px-3 py-2 ${layout.smallText} border-t border-border bg-card`}>
            <div className="flex items-center space-x-4 text-muted-foreground">
              <span>{lines.length} {t("recentEdits.lines")}</span>
              <span>{language}</span>
            </div>
            <div className="text-muted-foreground">
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
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-muted-foreground" />
        <p className={`${layout.bodyText} text-muted-foreground`}>
          {t("recentEdits.loading")}
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className={`${layout.bodyText} text-destructive`}>{error}</div>
      </div>
    );
  }

  // Empty state
  if (!recentEdits || recentEdits.files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <File className="w-12 h-12 mb-4 text-muted-foreground/50" />
        <p className="text-lg mb-2 text-muted-foreground">
          {t("recentEdits.noEdits")}
        </p>
        <p className={`${layout.bodyText} text-muted-foreground`}>
          {t("recentEdits.noEditsDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header with stats */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
              <FileEdit className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                {t("recentEdits.title")}
              </h2>
              <p className={`${layout.smallText} text-muted-foreground`}>
                {t("recentEdits.stats", {
                  files: stats.uniqueFilesCount,
                  edits: stats.totalEditsCount,
                })}
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-2 ${layout.bodyText} text-accent bg-accent/10 px-3 py-1.5 rounded-full`}>
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-medium">{stats.totalEditsCount} edits</span>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
            <Search className="w-4 h-4 text-muted-foreground" />
          </div>
          <input
            type="text"
            placeholder={t("recentEdits.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-14 pr-4 py-3 rounded-xl border-2 ${layout.bodyText} border-border bg-card text-foreground focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all duration-300`}
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto space-y-3">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className={`${layout.bodyText} text-muted-foreground`}>
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
      <div className="mt-4 pt-4 border-t border-border/50">
        <div className={`flex items-center gap-2 ${layout.smallText} text-muted-foreground`}>
          <div className="w-1 h-1 rounded-full bg-accent/50" />
          {t("recentEdits.footerInfo")}
        </div>
      </div>
    </div>
  );
};
