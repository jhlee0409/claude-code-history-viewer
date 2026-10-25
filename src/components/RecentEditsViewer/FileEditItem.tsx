/**
 * FileEditItem Component
 *
 * Displays a single file edit with expandable code preview and restore functionality.
 */

"use client";

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "../common";
import {
  FilePen,
  FileDiff,
  FilePlus,
  Clock,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
  FolderOpen,
} from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "@/lib/utils";
import { getPathLeaf } from "@/utils/pathUtils";
import { layout } from "@/components/renderers";
import { DiffWithMenu } from "../transcript/DiffViewComparison";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { FileEditDirectoryLink } from "./FileEditDirectoryLink";
import { FilteredDiffLines } from "./FilteredDiffLines";
import { RestoreDiffPreview } from "./RestoreDiffPreview";
import { useFileEditActions } from "./useFileEditActions";
import type { FileEditItemProps, EditViewMode } from "./types";
import { getLanguageFromPath, formatTimestamp, getRelativeTime } from "./utils";
import { extractAddedLines, extractRemovedLines } from "./diffUtils";
import type { DiffLineGroup } from "./diffUtils";
import {
  getPreStyles,
  getLineStyles,
  getTokenStyles,
  getLineNumberStyles,
  getTokenContainerStyles,
} from "@/utils/prismStyles";
import { Num } from "@/lib/format/Num";

export const FileEditItem: React.FC<FileEditItemProps> = ({
  edit,
  isDarkMode,
  onRestored,
  restoreScope,
}) => {
  const { t } = useTranslation();
  const { t: tCommon } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<EditViewMode>("content");
  // Copy, reveal and restore live in `useFileEditActions`, shared with
  // `FileEditRowCompact`. The card kept its own copies until now, and they had
  // already drifted: a failed copy was swallowed instead of surfacing a toast,
  // and neither transient timer was held, so a second click inherited the first
  // one's countdown and an unmounted row could still set state.
  const {
    copied,
    copy,
    canReveal,
    revealLabel,
    reveal,
    canRestore,
    restoreStatus,
    restoreError,
    isConfirmingRestore,
    requestRestore,
    confirmRestore,
    cancelRestore,
  } = useFileEditActions(edit, { onRestored, restoreScope });

  // A row that is not a whole file keeps its Restore button, aria-disabled but
  // still focusable, so the tooltip and screen readers can say why instead of
  // the action silently vanishing.
  const restoreLabel = canRestore
    ? t("recentEdits.restoreFile")
    : t("recentEdits.restoreUnavailable");

  const language = getLanguageFromPath(edit.file_path);
  const fileName = getPathLeaf(edit.file_path);
  const lines = edit.content_after_change.split("\n");

  // Clicking the active control again collapses; otherwise expand into that view
  const toggleView = (mode: EditViewMode) => {
    if (isExpanded && viewMode === mode) {
      setIsExpanded(false);
    } else {
      setViewMode(mode);
      setIsExpanded(true);
    }
  };

  const filteredGroups = useMemo<DiffLineGroup[]>(() => {
    if (!isExpanded || (viewMode !== "added" && viewMode !== "removed")) {
      return [];
    }
    return viewMode === "added"
      ? extractAddedLines(edit.original_content, edit.content_after_change)
      : extractRemovedLines(edit.original_content, edit.content_after_change);
  }, [isExpanded, viewMode, edit.original_content, edit.content_after_change]);

  return (
    <div className="border-2 rounded-xl overflow-hidden transition-all duration-300 border-border bg-card hover:border-accent/30 hover:shadow-md">
      {/* Header */}
      <div
        data-testid="file-edit-header"
        className={cn(
          /*
            Wraps to a second line rather than letting the name collapse. The
            stats group on the right is `shrink-0`, so at narrow widths (a
            phone) it took the whole row and the name box - `flex-1 min-w-0` -
            shrank to zero, leaving `truncate` with nothing to show. The file
            name is the one thing a row must never lose.

            Driven by a min-width plus `flex-wrap`, not by a `sm:`/`md:` prefix:
            the screen's width depends on the sidebar and inspector, not only
            on the viewport.
          */
          "relative flex flex-wrap items-center justify-between gap-y-2 cursor-pointer transition-all duration-300",
          "p-4",
          edit.operation_type === "write"
            ? "bg-gradient-to-r from-success/10 to-success/5"
            : "bg-gradient-to-r from-info/10 to-info/5",
          isExpanded && "border-b border-border"
        )}
        onClick={() => toggleView("content")}
      >
        {/* Left accent bar */}
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1",
            edit.operation_type === "write" ? "bg-success" : "bg-info"
          )}
        />

        {/*
          A floor of 10rem, not `min-w-0`. `min-w-0` is what lets a flex child
          shrink past its content, which is exactly how the name reached zero
          width. The floor makes the stats group wrap instead. The name box
          inside keeps `min-w-0` so it can still truncate within this group.
        */}
        <div
          className={cn(
            "flex items-center flex-1 space-x-3 min-w-[10rem]"
          )}
        >
          {/* Expand/Collapse icon */}
          <div
            className={cn(
              "flex items-center justify-center transition-all duration-300 w-6 h-6 rounded-md",
              isExpanded ? "bg-accent/20 text-accent" : "bg-muted/50 text-muted-foreground"
            )}
          >
            {isExpanded ? (
              <span title={tCommon("common.collapse", "Collapse")}>
                <ChevronDown className="w-4 h-4" />
              </span>
            ) : (
              <span title={tCommon("common.expand", "Expand")}>
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Operation type */}
          <div
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              edit.operation_type === "write"
                ? "bg-success/20 text-success"
                : "bg-info/20 text-info"
            )}
          >
            {edit.operation_type === "write" ? (
              <span title={t("recentEdits.created", "Created")}><FilePlus className="w-4 h-4" /></span>
            ) : (
              <span title={t("recentEdits.edited", "Edited")}><FilePen className="w-4 h-4" /></span>
            )}
          </div>

          {/* File name and path */}
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "font-semibold truncate text-foreground"
              )}
            >
              {fileName}
            </div>
            <div className="mt-0.5 flex min-w-0">
              <FileEditDirectoryLink
                directory={edit.file_path}
                fullPath={edit.file_path}
                canReveal={canReveal}
                onReveal={reveal}
                revealLabel={revealLabel}
                className={cn(
                  "min-w-0 flex-1 text-muted-foreground",
                  layout.smallText
                )}
              />
            </div>
          </div>
        </div>

        {/*
          Right side info. Wraps and shrinks rather than staying rigid: once the
          header wrapped, this group still sat on one line at its full width and
          clipped its own trailing timestamp against the card's `overflow-hidden`.

          `gap-x-3` rather than `space-x-3`, because the margin-based spacing
          utilities apply to every child after the first, including the first on
          a wrapped line, which indents each new line by one gap.
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-2 min-w-0">
          {/* Diff stats — clickable filters for added/removed-only views */}
          <div className={`flex items-center space-x-2 ${layout.smallText} font-mono`}>
            {edit.lines_added > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleView("added");
                }}
                className={cn(
                  "text-success bg-success/15 px-1.5 py-0.5 rounded transition-all",
                  isExpanded && viewMode === "added"
                    ? "ring-2 ring-success/70"
                    : "hover:ring-1 hover:ring-success/50"
                )}
                title={t("recentEdits.showAddedLines")}
                aria-label={t("recentEdits.showAddedLines")}
                aria-pressed={isExpanded && viewMode === "added"}
              >
                +{edit.lines_added}
              </button>
            )}
            {edit.lines_removed > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleView("removed");
                }}
                className={cn(
                  "text-destructive bg-destructive/15 px-1.5 py-0.5 rounded transition-all",
                  isExpanded && viewMode === "removed"
                    ? "ring-2 ring-destructive/70"
                    : "hover:ring-1 hover:ring-destructive/50"
                )}
                title={t("recentEdits.showRemovedLines")}
                aria-label={t("recentEdits.showRemovedLines")}
                aria-pressed={isExpanded && viewMode === "removed"}
              >
                -{edit.lines_removed}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleView("diff");
              }}
              className={cn(
                "flex items-center space-x-1 px-1.5 py-0.5 rounded transition-all",
                isExpanded && viewMode === "diff"
                  ? "bg-accent/20 text-accent ring-2 ring-accent/50"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:ring-1 hover:ring-accent/40"
              )}
              title={t("recentEdits.showDiff")}
              aria-label={t("recentEdits.showDiff")}
              aria-pressed={isExpanded && viewMode === "diff"}
            >
              <FileDiff className="w-3.5 h-3.5" />
              <span>{t("recentEdits.diff")}</span>
            </button>
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
            <span title={t("recentEdits.timestamp", "Timestamp")}><Clock className="w-3.5 h-3.5" /></span>
            <span title={formatTimestamp(edit.timestamp)}>
              <Num>{getRelativeTime(edit.timestamp, tCommon)}</Num>
            </span>
          </div>

          {/* Reveal in folder button (desktop only) */}
          {canReveal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                reveal();
              }}
              className="p-2 rounded-lg transition-all duration-200 hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={revealLabel}
              title={revealLabel}
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}

          {/* Copy button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              copy();
            }}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              copied
                ? "bg-success/20 text-success ring-1 ring-success/30"
                : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
            // The transient success state is the only externally observable
            // signal that a copy landed, so it carries a stable hook rather
            // than leaving tests to match on an icon's class names.
            data-testid={copied ? "file-edit-copied" : "file-edit-copy"}
            title={t("recentEdits.copyContent")}
            aria-label={t("recentEdits.copyContent")}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Restore button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!canRestore) return;
              if (restoreStatus === "idle") {
                requestRestore();
              }
            }}
            // `aria-disabled` rather than `disabled` when unavailable: a natively
            // disabled button leaves the tab order, hiding the reason from
            // keyboard and screen-reader users. Only the in-flight restore is
            // natively disabled.
            aria-disabled={!canRestore || undefined}
            disabled={canRestore && restoreStatus === "loading"}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              !canRestore
                ? "text-muted-foreground/40 cursor-not-allowed"
                : restoreStatus === "success"
                  ? "bg-success/20 text-success ring-1 ring-success/30"
                  : restoreStatus === "error"
                    ? "bg-destructive/20 text-destructive ring-1 ring-destructive/30"
                    : restoreStatus === "loading"
                      ? "bg-muted text-muted-foreground cursor-wait"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
            title={restoreLabel}
            aria-label={restoreLabel}
          >
            {restoreStatus === "loading" ? (
              <LoaderCircle className="w-4 h-4 animate-spin" />
            ) : restoreStatus === "success" ? (
              <Check className="w-4 h-4" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Error message toast */}
      {restoreError && (
        <div
          className={`mx-3 mb-2 p-2 rounded-md bg-destructive/10 text-destructive ${layout.smallText}`}
        >
          {t("recentEdits.restoreError")}: {restoreError}
        </div>
      )}

      {/* Confirmation dialog */}
      {isConfirmingRestore && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={cancelRestore}
        >
          <div
            className="rounded-lg p-6 max-w-md mx-4 shadow-xl bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-title font-semibold mb-2 text-foreground">
              {t("recentEdits.confirmRestoreTitle")}
            </h3>
            <p className={`${layout.bodyText} mb-2 text-muted-foreground`}>
              {t("recentEdits.confirmRestoreMessage", { path: edit.file_path })}
            </p>

            {/*
              The same preview the compact row shows. Restore is equally
              destructive from either density, so the confirmation must tell the
              user the same thing in both.
            */}
            <div className="mb-4">
              <RestoreDiffPreview
                filePath={edit.file_path}
                restoreContent={edit.content_after_change}
                existsOnDisk={edit.exists_on_disk}
                restoreScope={restoreScope}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelRestore}
                className={`px-4 py-2 rounded-md ${layout.bodyText} bg-muted hover:bg-muted/80 text-foreground`}
              >
                {t("recentEdits.cancel")}
              </button>
              <button
                onClick={confirmRestore}
                className={`px-4 py-2 rounded-md ${layout.bodyText} bg-accent hover:bg-accent/90 text-accent-foreground`}
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
          {/* Full diff view: the unified DiffView (unchanged runs folded,
              a line cap), the older viewers behind its … menu (TR2a).
              ExpandKeyProvider is required by useCaptureExpandState inside
              DiffView and AdvancedTextDiff, which otherwise throw outside
              MessageViewer. */}
          {viewMode === "diff" && (
            <div className="p-3">
              <ExpandKeyProvider value={`recent-edits:${edit.session_id}:${edit.file_path}:${edit.timestamp}`}>
                <DiffWithMenu
                  oldText={edit.original_content ?? ""}
                  newText={edit.content_after_change}
                  filePath={edit.file_path}
                  expandKey="diff"
                />
              </ExpandKeyProvider>
            </div>
          )}

          {/* Added/removed-only view */}
          {(viewMode === "added" || viewMode === "removed") && (
            <div className="max-h-96 overflow-auto">
              <FilteredDiffLines groups={filteredGroups} kind={viewMode} />
            </div>
          )}

          {/* Code/Markdown content */}
          {viewMode === "content" && (
            <div className="max-h-96 overflow-auto">
              {language === "markdown" ? (
                <Markdown className="p-3 bg-card text-foreground">
                  {edit.content_after_change}
                </Markdown>
              ) : (
                <Highlight
                  theme={isDarkMode ? themes.vsDark : themes.vsLight}
                  code={edit.content_after_change}
                  language={
                    language === "tsx" ? "typescript" : language === "jsx" ? "javascript" : language
                  }
                >
                  {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre
                      className={className}
                      style={getPreStyles(isDarkMode, style, {
                        fontSize: "var(--text-code)",
                        lineHeight: "var(--text-code--line-height)",
                        padding: "0.75rem",
                      })}
                    >
                      {tokens.map((line, i) => {
                        const {
                          key: lineKey,
                          ...lineProps
                        } = getLineProps({ line, key: i }) as React.HTMLAttributes<HTMLDivElement> & {
                          key?: React.Key;
                          style?: React.CSSProperties;
                        };
                        return (
                          <div
                            key={lineKey ?? i}
                            {...lineProps}
                            style={getLineStyles(lineProps.style, { display: "table-row" })}
                          >
                            <span style={getLineNumberStyles()}>
                              {i + 1}
                            </span>
                            <span style={getTokenContainerStyles()}>
                              {line.map((token, tokenIndex) => {
                                const {
                                  key: tokenKey,
                                  ...tokenProps
                                } = getTokenProps({ token, key: tokenIndex }) as React.HTMLAttributes<HTMLSpanElement> & {
                                  key?: React.Key;
                                  style?: React.CSSProperties;
                                };
                                return (
                                  <span
                                    key={tokenKey ?? tokenIndex}
                                    {...tokenProps}
                                    style={getTokenStyles(isDarkMode, tokenProps.style)}
                                  />
                                );
                              })}
                            </span>
                          </div>
                        );
                      })}
                    </pre>
                  )}
                </Highlight>
              )}
            </div>
          )}

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
            <div className="text-muted-foreground"><Num>{formatTimestamp(edit.timestamp)}</Num></div>
          </div>
        </div>
      )}
    </div>
  );
};

FileEditItem.displayName = "FileEditItem";
