import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCheck,
  Copy,
  DownloadCloud,
  Loader2,
  TerminalSquare as SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { usePlatform } from "@/contexts/platform";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import {
  supportsResumeCommandForSession,
  supportsSessionDeletion,
} from "@/utils/providers";
import type { ClaudeSession } from "@/types";
import { useSessionBatchActions } from "../hooks/useSessionBatchActions";
import { SessionMultiDeleteDialog } from "./SessionMultiDeleteDialog";
import { SessionMultiResumeDialog } from "./SessionMultiResumeDialog";

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
  const { isDesktop } = usePlatform();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isResumeDialogOpen, setIsResumeDialogOpen] = useState(false);

  const sessionSelectionIds = useAppStore((s) => s.sessionSelectionIds);
  const isServerReadOnly = useAppStore((s) => s.isServerReadOnly);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const setSessionSelectionIds = useAppStore((s) => s.setSessionSelectionIds);
  const clearSessionSelection = useAppStore((s) => s.clearSessionSelection);
  const exitSessionSelectionMode = useAppStore((s) => s.exitSessionSelectionMode);
  const getSessionDisplayName = useAppStore((s) => s.getSessionDisplayName);
  // Session-list pagination state: the project may have more sessions on disk
  // than are loaded (250/page). "Select all" must not silently mean "select
  // the loaded page" when that's the case.
  const sessionsTotal = useAppStore((s) => s.sessionsTotal);
  const hasMoreSessions = useAppStore((s) => s.hasMoreSessions);
  const loadMoreSessions = useAppStore((s) => s.loadMoreSessions);

  const [isLoadingAll, setIsLoadingAll] = useState(false);
  // Fresh view of the visible sessions for the async load-all loop — the
  // closure would otherwise select from a stale, pre-load list.
  const visibleSessionsRef = useRef(visibleSessions);
  useEffect(() => {
    visibleSessionsRef.current = visibleSessions;
  });

  const { isDeleting, isResuming, deleteSessions, resumeSessions, copyIds } =
    useSessionBatchActions();

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
  const resumableSessions = useMemo(
    () =>
      selectedSessions.filter((s) =>
        supportsResumeCommandForSession(s.provider ?? "claude", s.entrypoint)
      ),
    [selectedSessions]
  );

  const selectedCount = selectedSessions.length;
  const deletableCount = deletableSessions.length;
  const skippedCount = selectedCount - deletableCount;
  const resumableCount = resumableSessions.length;
  const resumeSkippedCount = selectedCount - resumableCount;

  const allVisibleSelected =
    visibleSessions.length > 0 &&
    visibleSessions.every((s) => idSet.has(s.session_id));

  // Escape leaves selection mode, but only when a confirm dialog isn't
  // open (there Escape closes the dialog) and no operation is in flight.
  useEffect(() => {
    if (isDeleteDialogOpen || isResumeDialogOpen || isDeleting || isResuming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSessionSelectionMode();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    isDeleteDialogOpen,
    isResumeDialogOpen,
    isDeleting,
    isResuming,
    exitSessionSelectionMode,
  ]);

  const handleToggleAll = () => {
    if (allVisibleSelected) {
      clearSessionSelection();
    } else {
      setSessionSelectionIds(visibleSessions.map((s) => s.session_id));
    }
  };

  // Page in every remaining session, then select everything visible. Bounded
  // by a stall check (no growth between iterations aborts the loop) so a
  // backend that never flips hasMore cannot spin forever.
  const handleLoadAllAndSelect = async () => {
    if (isLoadingAll) return;
    setIsLoadingAll(true);
    try {
      let previousCount = -1;
      while (
        useAppStore.getState().hasMoreSessions &&
        useAppStore.getState().isSessionSelectionMode
      ) {
        const loaded = useAppStore.getState().sessions.length;
        if (loaded === previousCount) break;
        previousCount = loaded;
        await loadMoreSessions();
      }
      if (useAppStore.getState().isSessionSelectionMode) {
        setSessionSelectionIds(
          visibleSessionsRef.current.map((s) => s.session_id)
        );
      }
    } catch (error) {
      const description =
        error instanceof Error ? error.message : String(error);
      console.error("[session selection] load-all failed", error);
      toast.error(
        t("session.selection.loadAllError", "Failed to load all sessions"),
        { description }
      );
    } finally {
      setIsLoadingAll(false);
    }
  };

  const deleteNames = useMemo(
    () =>
      deletableSessions.map(
        (s) => getSessionDisplayName(s.session_id, s.summary) || s.actual_session_id
      ),
    [deletableSessions, getSessionDisplayName]
  );
  const resumeNames = useMemo(
    () =>
      resumableSessions.map(
        (s) => getSessionDisplayName(s.session_id, s.summary) || s.actual_session_id
      ),
    [resumableSessions, getSessionDisplayName]
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

  const handleConfirmResume = async () => {
    try {
      await resumeSessions(resumableSessions, selectedProject?.actual_path);
    } catch (error) {
      const description =
        error instanceof Error ? error.message : String(error);
      console.error("[session selection] confirm resume failed", error);
      toast.error(t("session.selection.resumeError", "Failed to open terminal"), {
        description,
      });
    } finally {
      setIsResumeDialogOpen(false);
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

      {hasMoreSessions && (
        <div className="flex items-center gap-1 text-2xs text-amber-600 dark:text-amber-400">
          <span>
            {t("session.selection.partialNotice", {
              loaded: allSessions.length,
              total: sessionsTotal,
              defaultValue:
                "{{loaded}} of {{total}} sessions loaded — selection covers loaded sessions only",
            })}
          </span>
        </div>
      )}

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
              : t("session.selection.selectAllCount", {
                  count: visibleSessions.length,
                  defaultValue: "Select all ({{count}})",
                })}
          </span>
        </button>

        {hasMoreSessions && (
          <button
            type="button"
            onClick={() => void handleLoadAllAndSelect()}
            disabled={isLoadingAll}
            className={cn(actionButtonClass, "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
          >
            {isLoadingAll ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <DownloadCloud className="h-3 w-3" />
            )}
            <span>
              {isLoadingAll
                ? t("session.selection.loadingAll", {
                    loaded: allSessions.length,
                    total: sessionsTotal,
                    defaultValue: "Loading {{loaded}}/{{total}}...",
                  })
                : t("session.selection.loadAllAndSelect", {
                    count: sessionsTotal,
                    defaultValue: "Load & select all {{count}}",
                  })}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => copyIds(selectedSessions)}
          disabled={selectedCount === 0}
          className={cn(actionButtonClass, "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
        >
          <Copy className="h-3 w-3" />
          <span>{t("session.selection.copyIds", "Copy IDs")}</span>
        </button>

        {!isServerReadOnly && isDesktop && (
          <button
            type="button"
            onClick={() => setIsResumeDialogOpen(true)}
            disabled={resumableCount === 0}
            className={cn(actionButtonClass, "ml-auto text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
          >
            <SquareTerminal className="h-3 w-3" />
            <span>
              {t("session.selection.resume", {
                count: resumableCount,
                defaultValue: "Resume ({{count}})",
              })}
            </span>
          </button>
        )}

        {!isServerReadOnly && (
          <button
            type="button"
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={deletableCount === 0}
            className={cn(actionButtonClass, "text-destructive hover:bg-destructive/10")}
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

      <SessionMultiResumeDialog
        open={isResumeDialogOpen}
        onOpenChange={(open) => {
          if (isResuming) return;
          setIsResumeDialogOpen(open);
        }}
        count={resumableCount}
        skippedCount={resumeSkippedCount}
        names={resumeNames}
        isResuming={isResuming}
        onConfirm={handleConfirmResume}
      />

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
