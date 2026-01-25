/**
 * FileEditItem Component
 *
 * Displays a single file edit with expandable code preview and restore functionality.
 */

"use client";

import React, { useState } from "react";
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
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Highlight } from "prism-react-renderer";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import type { FileEditItemProps, RestoreStatus } from "./types";
import { getLanguageFromPath, formatTimestamp, getRelativeTime } from "./utils";
import { getCodeTheme, getCodePreStyles, getLineNumberStyles } from "@/utils/codeThemeStyles";

export const FileEditItem: React.FC<FileEditItemProps> = ({ edit, isDarkMode }) => {
  const { t } = useTranslation();
  const { t: tCommon } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>("idle");
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
      setRestoreStatus("loading");
      await invoke("restore_file", {
        filePath: edit.file_path,
        content: edit.content_after_change,
      });
      setRestoreStatus("success");
      setTimeout(() => setRestoreStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to restore file:", err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setRestoreStatus("error");
      setTimeout(() => {
        setRestoreStatus("idle");
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
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
            <div className="font-semibold truncate text-foreground">{fileName}</div>
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
          <div
            className={`flex items-center space-x-1.5 ${layout.smallText} text-muted-foreground bg-muted/50 px-2 py-1 rounded-lg`}
          >
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
              if (restoreStatus === "idle") {
                handleRestoreClick();
              }
            }}
            disabled={restoreStatus === "loading"}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              restoreStatus === "success"
                ? "bg-success/20 text-success ring-1 ring-success/30"
                : restoreStatus === "error"
                ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30"
                : restoreStatus === "loading"
                ? "bg-muted text-muted-foreground cursor-wait"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
            title={t("recentEdits.restoreFile")}
          >
            {restoreStatus === "loading" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : restoreStatus === "success" ? (
              <Check className="w-4 h-4" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Error message toast */}
      {errorMessage && (
        <div
          className={`mx-3 mb-2 p-2 rounded-md bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 ${layout.smallText}`}
        >
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
              theme={getCodeTheme(isDarkMode)}
              code={edit.content_after_change}
              language={
                language === "tsx" ? "typescript" : language === "jsx" ? "javascript" : language
              }
            >
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={className}
                  style={{
                    ...style,
                    ...getCodePreStyles(isDarkMode),
                    margin: 0,
                    fontSize: "0.8125rem",
                    lineHeight: "1.25rem",
                    padding: "0.75rem",
                  }}
                >
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line, key: i })} style={{ display: "table-row" }}>
                      <span style={getLineNumberStyles(isDarkMode)}>
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
            className={`flex items-center justify-between px-3 py-2 ${layout.smallText} border-t border-border bg-card`}
          >
            <div className="flex items-center space-x-4 text-muted-foreground">
              <span>
                {lines.length} {t("recentEdits.lines")}
              </span>
              <span>{language}</span>
            </div>
            <div className="text-muted-foreground">{formatTimestamp(edit.timestamp)}</div>
          </div>
        </div>
      )}
    </div>
  );
};

FileEditItem.displayName = "FileEditItem";
