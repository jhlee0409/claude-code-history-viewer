/**
 * FileEditRowCompact
 *
 * The two-line, roughly 46px row used when Recent Edits runs at compact
 * density. Line 1 carries identity and magnitude, line 2 carries location.
 *
 *   > . HISTORY.md                       +25 -6   14h
 *       skills/deliver-prd/                  [reveal] [copy]
 *
 * The standard card stays in `FileEditItem.tsx`; this is a separate component
 * rather than a variant of it, because at 280px almost nothing about the card's
 * layout survives. Behaviour they genuinely share (copy, reveal, restore) lives
 * in `useFileEditActions` so the two cannot drift.
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { elideProjectRoot, getPathLeaf } from "@/utils/pathUtils";
import { useFileEditActions } from "./useFileEditActions";
import { FileEditExpansion } from "./FileEditExpansion";
import { getCompactRelativeTime, formatClockTime, formatTimestamp } from "./utils";
import type { EditViewMode } from "./types";
import type { RecentFileEdit } from "../../types";

export interface FileEditRowCompactProps {
  edit: RecentFileEdit;
  isDarkMode: boolean;
  /** Project root to strip from the directory line. */
  projectCwd?: string;
  /**
   * `file` shows relative time, since the row means "where this file ended
   * up". `edit` shows clock time, since a chronological stream needs ordering
   * more than recency.
   */
  grouping?: "file" | "edit";
  onJumpToMessage?: (messageUuid: string) => void;
  /** Called after a successful restore, so the list can clear the missing flag. */
  onRestored?: (filePath: string) => void;
}

export const FileEditRowCompact: React.FC<FileEditRowCompactProps> = ({
  edit,
  isDarkMode,
  projectCwd,
  grouping = "file",
  onJumpToMessage,
  onRestored,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<EditViewMode>("content");
  const actions = useFileEditActions(edit, { onRestored });

  const fileName = getPathLeaf(edit.file_path);
  const directory = elideProjectRoot(
    edit.file_path.slice(0, edit.file_path.length - fileName.length),
    projectCwd
  );

  // `exists_on_disk` is optional, so undefined means "unknown", not "deleted".
  const isMissing = edit.exists_on_disk === false;

  const timeLabel =
    grouping === "edit"
      ? formatClockTime(edit.timestamp)
      : getCompactRelativeTime(edit.timestamp, t);

  const dotLabel = isMissing
    ? t("recentEdits.missingOnDisk", "Missing on disk")
    : edit.operation_type === "write"
      ? t("recentEdits.created")
      : t("recentEdits.edited");

  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className="group border-b border-border/60 last:border-b-0">
      {/*
        `relative` wraps the header only, not the whole row. On the row it would
        stretch the full-bleed button below over the expansion too, so a click
        anywhere in the diff would collapse the row, and the expansion's own
        content would fight it for pointer events.
      */}
      <div className="relative">
      {/*
        The click target is a full-bleed button behind the content rather than a
        wrapper around it, so the row is one native button (keyboard operable,
        correct role) without nesting the hover action buttons inside it, which
        would be invalid HTML.
      */}
      <button
        type="button"
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        aria-label={fileName}
        className="absolute inset-0 h-full w-full rounded-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      />

      {/*
        Leading glyphs align to LINE 1, not to the vertical centre of the row.
        The top margins centre each glyph against the filename's 19px line box.
        This looks like an oversight and is not: plain `flex-start` aligns to the
        text ascender and reads visibly high, and `align-items: center` was
        reviewed and rejected because it drifts the glyphs down between the two
        lines. Do not "tidy" these away.
      */}
      <div className="pointer-events-none relative flex items-start gap-1.5 px-2 py-1">
        <ChevronIcon
          className="h-3 w-3 shrink-0 text-muted-foreground"
          style={{ marginTop: "3.5px" }}
          aria-hidden="true"
        />
        <span
          className={cn(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            isMissing
              ? "bg-destructive"
              : edit.operation_type === "write"
                ? "bg-success"
                : "bg-info"
          )}
          style={{ marginTop: "6px" }}
          title={dotLabel}
          aria-label={dotLabel}
          role="img"
        />

        <div className="min-w-0 flex-1">
          {/* Line 1: filename, then counts and time, right aligned. */}
          <div className="flex items-baseline gap-2 leading-[19px]">
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
              {fileName}
            </span>
            <span className="shrink-0 font-mono text-px11 text-muted-foreground">
              {edit.lines_added > 0 && (
                <span className="text-green-600 dark:text-green-400">
                  +{edit.lines_added}
                </span>
              )}
              {edit.lines_removed > 0 && (
                <span className="ml-1 text-red-600 dark:text-red-400">
                  -{edit.lines_removed}
                </span>
              )}
              <span
                className="ml-2 tabular-nums"
                title={formatTimestamp(edit.timestamp)}
              >
                {timeLabel}
              </span>
            </span>
          </div>

          {/* Line 2: elided directory, with actions revealed on hover. */}
          <div className="flex items-center gap-2 leading-[17px]">
            <span className="min-w-0 flex-1 truncate text-px11 text-muted-foreground">
              {directory}
            </span>
            <div
              className={cn(
                "pointer-events-auto flex shrink-0 items-center gap-0.5 transition-opacity",
                isExpanded
                  ? "opacity-100"
                  : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
              )}
            >
              {/*
                A missing file leads with Restore: revealing a file that is not
                there does nothing.
              */}
              {isMissing ? (
                <RestoreButton actions={actions} label={t("recentEdits.restoreFile")} />
              ) : (
                actions.canReveal && (
                  <button
                    type="button"
                    onClick={actions.reveal}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={actions.revealLabel}
                    title={actions.revealLabel}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                )
              )}

              <button
                type="button"
                onClick={actions.copy}
                className={cn(
                  "rounded p-0.5 transition-colors",
                  actions.copied
                    ? "text-success"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                aria-label={t("recentEdits.copyContent")}
                title={t("recentEdits.copyContent")}
              >
                {actions.copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>

              {!isMissing && (
                <RestoreButton actions={actions} label={t("recentEdits.restoreFile")} />
              )}
            </div>
          </div>
        </div>
      </div>
      </div>

      {actions.restoreError && (
        <div className="mx-2 mb-1 rounded bg-destructive/10 px-1.5 py-1 text-px11 text-destructive">
          {t("recentEdits.restoreError")}: {actions.restoreError}
        </div>
      )}

      {/*
        The repo's Dialog rather than a hand-rolled overlay. Restore writes a
        file to disk, so the confirmation is exactly the control that must be
        reachable without a pointer: Radix supplies role="dialog", aria-modal,
        the focus trap, focus restoration and Escape, none of which the previous
        bare div had.
      */}
      <Dialog
        open={actions.isConfirmingRestore}
        onOpenChange={(open) => {
          if (!open) actions.cancelRestore();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("recentEdits.confirmRestoreTitle")}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">
              {t("recentEdits.confirmRestoreMessage", { path: edit.file_path })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={actions.cancelRestore}
              className="rounded-md bg-muted px-4 py-2 text-sm text-foreground hover:bg-muted/80"
            >
              {t("recentEdits.cancel")}
            </button>
            <button
              type="button"
              onClick={actions.confirmRestore}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              {t("recentEdits.confirmRestore")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isExpanded && (
        <FileEditExpansion
            edit={edit}
            isDarkMode={isDarkMode}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onJumpToMessage={onJumpToMessage}
          jumpTargetsLatest={grouping === "file"}
        />
      )}
    </div>
  );
};

const RestoreButton: React.FC<{
  actions: ReturnType<typeof useFileEditActions>;
  label: string;
}> = ({ actions, label }) => (
  <button
    type="button"
    onClick={() => {
      if (actions.restoreStatus === "idle") actions.requestRestore();
    }}
    disabled={actions.restoreStatus === "loading"}
    className={cn(
      "rounded p-0.5 transition-colors",
      actions.restoreStatus === "success"
        ? "text-success"
        : actions.restoreStatus === "error"
          ? "text-destructive"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
    )}
    aria-label={label}
    title={label}
  >
    {actions.restoreStatus === "loading" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    ) : actions.restoreStatus === "success" ? (
      <Check className="h-3.5 w-3.5" />
    ) : (
      <RotateCcw className="h-3.5 w-3.5" />
    )}
  </button>
);

FileEditRowCompact.displayName = "FileEditRowCompact";
