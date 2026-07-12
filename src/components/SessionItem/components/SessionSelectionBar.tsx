import React, { useEffect, useMemo, useState } from "react";
import { CheckCheck, Copy, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { supportsSessionDeletion } from "@/utils/providers";
import type { ClaudeSession } from "@/types";
import { useSessionBatchActions } from "../hooks/useSessionBatchActions";
import { SessionMultiDeleteDialog } from "./SessionMultiDeleteDialog";

interface SessionSelectionBarProps {
  /** All sessions loaded for the project (used to resolve selected IDs). */
  allSessions: ClaudeSession[];
  /** Sessions currently visible after search/filter (drives "Select all"). */
  visibleSessions: ClaudeSession[];
}

const actionButtonClass = cn(
  "flex items-center gap-1 rounded px-1.5 py-1 text-2xs font-medium transition-colors",
  "disabled:opacity-40 disabled:pointer-events-none"
);

export const SessionSelectionBar: React.FC<SessionSelectionBarProps> = ({
  allSessions,
  visibleSessions,
}) => {
  const { t } = useTranslation();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const sessionSelectionIds = useAppStore((s) => s.sessionSelectionIds);
  const isServerReadOnly = useAppStore((s) => s.isServerReadOnly);
  const setSessionSelectionIds = useAppStore((s) => s.setSessionSelectionIds);
  const clearSessionSelection = useAppStore((s) => s.clearSessionSelection);
  const exitSessionSelectionMode = useAppStore((s) => s.exitSessionSelectionMode);
  const getSessionDisplayName = useAppStore((s) => s.getSessionDisplayName);

  const { isDeleting, deleteSessions, copyIds } = useSessionBatchActions();

  const idSet = useMemo(() => new Set(sessionSelectionIds), [sessionSelectionIds]);

  const selectedSessions = useMemo(
    () => allSessions.filter((s) => idSet.has(s.session_id)),
    [allSessions, idSet]
  );
  const deletableSessions = useMemo(
    () =>
      isServerReadOnly
        ? []
        : selectedSessions.filter((s) => supportsSessionDeletion(s.provider ?? "claude")),
    [isServerReadOnly, selectedSessions]
  );

  const selectedCount = selectedSessions.length;
  const deletableCount = deletableSessions.length;
  const skippedCount = selectedCount - deletableCount;

  const allVisibleSelected =
    visibleSessions.length > 0 &&
    visibleSessions.every((s) => idSet.has(s.session_id));

  // Escape leaves selection mode, but only when the confirm dialog isn't
  // open (there Escape closes the dialog) and no delete is in flight.
  useEffect(() => {
    if (isDeleteDialogOpen || isDeleting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSessionSelectionMode();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDeleteDialogOpen, isDeleting, exitSessionSelectionMode]);

  const handleToggleAll = () => {
    if (allVisibleSelected) {
      clearSessionSelection();
    } else {
      setSessionSelectionIds(visibleSessions.map((s) => s.session_id));
    }
  };

  const deleteNames = useMemo(
    () =>
      deletableSessions.map(
        (s) => getSessionDisplayName(s.session_id, s.summary) || s.actual_session_id
      ),
    [deletableSessions, getSessionDisplayName]
  );

  const handleConfirmDelete = async () => {
    try {
      await deleteSessions(deletableSessions);
    } catch (error) {
      // deleteSessions reports its own failures; this guards anything
      // unexpected so it surfaces instead of rejecting unhandled and
      // leaving the dialog stuck open.
      const description =
        error instanceof Error ? error.message : String(error);
      console.error("[session selection] confirm delete failed", error);
      toast.error(t("session.deleteError", "Failed to delete session"), {
        description,
      });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  };

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b border-border/30 bg-sidebar/95 px-2 py-1.5 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-foreground">
          {t("session.selection.count", {
            count: selectedCount,
            defaultValue: "{{count}} selected",
          })}
        </span>
        <button
          type="button"
          onClick={exitSessionSelectionMode}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label={t("session.selection.exit", "Exit selection")}
          title={t("session.selection.exit", "Exit selection")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={handleToggleAll}
          className={cn(actionButtonClass, "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
        >
          <CheckCheck className="h-3 w-3" />
          <span>
            {allVisibleSelected
              ? t("session.selection.clear", "Clear")
              : t("session.selection.selectAll", "Select all")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => copyIds(selectedSessions)}
          disabled={selectedCount === 0}
          className={cn(actionButtonClass, "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
        >
          <Copy className="h-3 w-3" />
          <span>{t("session.selection.copyIds", "Copy IDs")}</span>
        </button>

        {!isServerReadOnly && (
          <button
            type="button"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={deletableCount === 0}
            className={cn(actionButtonClass, "ml-auto text-destructive hover:bg-destructive/10")}
          >
            <Trash2 className="h-3 w-3" />
            <span>
              {t("session.selection.delete", {
                count: deletableCount,
                defaultValue: "Delete ({{count}})",
              })}
            </span>
          </button>
        )}
      </div>

      <SessionMultiDeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (isDeleting) return;
          setIsDeleteDialogOpen(open);
        }}
        count={deletableCount}
        skippedCount={skippedCount}
        names={deleteNames}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
