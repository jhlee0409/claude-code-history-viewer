/**
 * Expanded body of a compact Recent Edits row.
 *
 * Carries the four existing `EditViewMode` views, the full absolute path (which
 * is what makes the aggressive elision on line 2 safe), and the
 * jump-to-message arrow.
 */

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileDiff, CornerDownLeft } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "@/lib/utils";
import { Markdown } from "../common";
import { ExpandKeyProvider } from "@/contexts/CaptureExpandContext";
import { EnhancedDiffViewer } from "../EnhancedDiffViewer";
import { FilteredDiffLines } from "./FilteredDiffLines";
import { extractAddedLines, extractRemovedLines } from "./diffUtils";
import type { DiffLineGroup } from "./diffUtils";
import { getLanguageFromPath, formatTimestamp } from "./utils";
import type { EditViewMode } from "./types";
import type { RecentFileEdit } from "../../types";
import {
  getPreStyles,
  getLineStyles,
  getTokenStyles,
  getLineNumberStyles,
  getTokenContainerStyles,
} from "@/utils/prismStyles";

export interface FileEditExpansionProps {
  edit: RecentFileEdit;
  isDarkMode: boolean;
  viewMode: EditViewMode;
  onViewModeChange: (mode: EditViewMode) => void;
  /**
   * Scroll the transcript to the message this edit came from. Omitted, or
   * paired with an edit that has no `message_uuid`, hides the arrow.
   */
  onJumpToMessage?: (messageUuid: string) => void;
  /**
   * In per-file grouping a row stands for several edits, so the arrow lands on
   * the most recent one and the tooltip has to say so.
   */
  jumpTargetsLatest?: boolean;
}

const CHIPS: ReadonlyArray<{
  mode: EditViewMode;
  labelKey: string;
  fallback: string;
  /**
   * The descriptive form, kept as `title` and `aria-label`. The visible label
   * is the short one: "Show only added lines" reads as an instruction and set
   * four sentences side by side in a panel, where the state is one selection
   * out of four and should look like it.
   */
  hintKey: string;
  hintFallback: string;
}> = [
  {
    mode: "content",
    labelKey: "recentEdits.viewContent",
    fallback: "Content",
    hintKey: "recentEdits.viewContent",
    hintFallback: "Content",
  },
  {
    mode: "added",
    labelKey: "recentEdits.viewAdded",
    fallback: "Added",
    hintKey: "recentEdits.showAddedLines",
    hintFallback: "Show only added lines",
  },
  {
    mode: "removed",
    labelKey: "recentEdits.viewRemoved",
    fallback: "Removed",
    hintKey: "recentEdits.showRemovedLines",
    hintFallback: "Show only removed lines",
  },
  {
    mode: "diff",
    labelKey: "recentEdits.diff",
    fallback: "Diff",
    hintKey: "recentEdits.diff",
    hintFallback: "Diff",
  },
];

export const FileEditExpansion: React.FC<FileEditExpansionProps> = ({
  edit,
  isDarkMode,
  viewMode,
  onViewModeChange,
  onJumpToMessage,
  jumpTargetsLatest = false,
}) => {
  const { t } = useTranslation();
  const language = getLanguageFromPath(edit.file_path);

  const filteredGroups = useMemo<DiffLineGroup[]>(() => {
    if (viewMode !== "added" && viewMode !== "removed") return [];
    return viewMode === "added"
      ? extractAddedLines(edit.original_content, edit.content_after_change)
      : extractRemovedLines(edit.original_content, edit.content_after_change);
  }, [viewMode, edit.original_content, edit.content_after_change]);

  const messageUuid = edit.message_uuid;
  const canJump = Boolean(onJumpToMessage && messageUuid);
  const jumpLabel = jumpTargetsLatest
    ? t("recentEdits.jumpToLatestEdit", "Jump to the most recent edit")
    : t("recentEdits.jumpToMessage", "Jump to message");

  return (
    <div className="border-t border-border bg-card/40">
      {/* Full absolute path, plus the jump arrow. */}
      <div className="flex items-start gap-2 px-2 py-1.5">
        <code className="min-w-0 flex-1 break-all text-px11 text-muted-foreground">
          {edit.file_path}
        </code>
        {canJump && (
          <button
            type="button"
            onClick={() => onJumpToMessage?.(messageUuid as string)}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={jumpLabel}
            title={jumpLabel}
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/*
        One segmented control rather than four loose chips. The four modes are
        mutually exclusive - one selection, always exactly one - and a bordered
        group with dividers says that, where separated chips read as four
        independent toggles that happen to be near each other.
      */}
      <div className="px-2 pb-1.5">
        <div
          role="group"
          aria-label={t("recentEdits.viewModeGroup", "View mode")}
          className="inline-flex flex-wrap overflow-hidden rounded-md border border-border"
        >
          {CHIPS.map((chip) => {
            const active = viewMode === chip.mode;
            const label = t(chip.labelKey, chip.fallback);
            const hint = t(chip.hintKey, chip.hintFallback);
            return (
              <button
                key={chip.mode}
                type="button"
                onClick={() => onViewModeChange(chip.mode)}
                aria-pressed={active}
                title={hint}
                aria-label={hint}
                className={cn(
                  "flex items-center gap-1 border-r border-border px-2 py-0.5 text-px11 transition-colors last:border-r-0",
                  active
                    ? "bg-accent/20 text-accent"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {chip.mode === "diff" && <FileDiff className="h-3 w-3" />}
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {viewMode === "diff" && (
        <div className="p-2">
          {/*
            Keyed per edit, not per file. In edit grouping the same file appears
            as several distinct rows, and a path-only key made them share one
            registry entry, so expanding the advanced diff in one row silently
            toggled it in the others.
          */}
          <ExpandKeyProvider
            value={`recent-edits-compact:${edit.file_path}:${
              edit.message_uuid ?? edit.timestamp
            }`}
          >
            <EnhancedDiffViewer
              oldText={edit.original_content ?? ""}
              newText={edit.content_after_change}
              filePath={edit.file_path}
              showAdvancedDiff={true}
              defaultMode="visual"
            />
          </ExpandKeyProvider>
        </div>
      )}

      {(viewMode === "added" || viewMode === "removed") && (
        <div className="max-h-80 overflow-auto">
          <FilteredDiffLines groups={filteredGroups} kind={viewMode} />
        </div>
      )}

      {viewMode === "content" && (
        <div className="max-h-80 overflow-auto">
          {language === "markdown" ? (
            <Markdown className="p-2 bg-card text-foreground">
              {edit.content_after_change}
            </Markdown>
          ) : (
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
                  style={getPreStyles(isDarkMode, style, {
                    fontSize: "calc(0.75rem * var(--app-font-scale))",
                    lineHeight: "1.15rem",
                    padding: "0.5rem",
                  })}
                >
                  {tokens.map((line, i) => {
                    const { key: lineKey, ...lineProps } = getLineProps({
                      line,
                      key: i,
                    }) as React.HTMLAttributes<HTMLDivElement> & {
                      key?: React.Key;
                      style?: React.CSSProperties;
                    };
                    return (
                      <div
                        key={lineKey ?? i}
                        {...lineProps}
                        style={getLineStyles(lineProps.style, {
                          display: "table-row",
                        })}
                      >
                        <span style={getLineNumberStyles()}>{i + 1}</span>
                        <span style={getTokenContainerStyles()}>
                          {line.map((token, tokenIndex) => {
                            const { key: tokenKey, ...tokenProps } =
                              getTokenProps({
                                token,
                                key: tokenIndex,
                              }) as React.HTMLAttributes<HTMLSpanElement> & {
                                key?: React.Key;
                                style?: React.CSSProperties;
                              };
                            return (
                              <span
                                key={tokenKey ?? tokenIndex}
                                {...tokenProps}
                                style={getTokenStyles(
                                  isDarkMode,
                                  tokenProps.style
                                )}
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

      <div className="flex items-center justify-between border-t border-border px-2 py-1 text-px11 text-muted-foreground">
        <span>{language}</span>
        <span>{formatTimestamp(edit.timestamp)}</span>
      </div>
    </div>
  );
};

FileEditExpansion.displayName = "FileEditExpansion";
