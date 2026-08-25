/**
 * RecentEditsPanel
 *
 * The Recent Edits view as it appears docked beside the transcript: a one-row
 * header of controls, then the list.
 *
 * Deliberately not virtualized. A page is 20 rows, and rows change height when
 * expanded, which a fixed-estimate virtualizer handles badly. `MessageNavigator`
 * virtualizes because it renders every message in a session; this does not.
 */

import React, { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FileEdit, Loader2 } from "lucide-react";
import { useTheme } from "@/contexts/theme";
import { useAppStore } from "@/store/useAppStore";
import {
  recentEditsDockRequestKey,
  selectRecentEditsDensity,
  selectRecentEditsGrouping,
  type RecentEditsDockRequest,
} from "@/store/slices/recentEditsPanelSlice";
import { FileEditItem } from "./FileEditItem";
import { FileEditRowCompact } from "./FileEditRowCompact";
import {
  RecentEditsDensityToggle,
  RecentEditsScopeToggle,
} from "./RecentEditsToggles";
import { RecentEditsOptionsMenu } from "./RecentEditsOptionsMenu";

export const RecentEditsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();

  const selectedSession = useAppStore((s) => s.selectedSession);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const navigateToMessage = useAppStore((s) => s.navigateToMessage);

  const recentEdits = useAppStore((s) => s.recentEditsDock);
  const isLoading = useAppStore((s) => s.isLoadingRecentEditsDock);
  const isLoadingMore = useAppStore((s) => s.isLoadingMoreRecentEditsDock);
  const error = useAppStore((s) => s.recentEditsDockError);
  const loadRecentEditsDock = useAppStore((s) => s.loadRecentEditsDock);
  const loadMoreRecentEditsDock = useAppStore(
    (s) => s.loadMoreRecentEditsDock
  );
  const markRecentEditsDockFileRestored = useAppStore(
    (s) => s.markRecentEditsDockFileRestored
  );

  const recentEditsMode = useAppStore((s) => s.recentEditsMode);
  const recentEditsScope = useAppStore((s) => s.recentEditsScope);
  const recentEditsMissingOnly = useAppStore((s) => s.recentEditsMissingOnly);
  const setRecentEditsScope = useAppStore((s) => s.setRecentEditsScope);
  const setRecentEditsDensity = useAppStore((s) => s.setRecentEditsDensity);
  const setRecentEditsGrouping = useAppStore((s) => s.setRecentEditsGrouping);
  const setRecentEditsMissingOnly = useAppStore(
    (s) => s.setRecentEditsMissingOnly
  );

  const density = useAppStore(selectRecentEditsDensity);
  const grouping = useAppStore(selectRecentEditsGrouping);

  // With no session selected, session scope has nothing to point at.
  const canScopeToSession = Boolean(selectedSession);
  const effectiveScope = canScopeToSession ? recentEditsScope : "project";

  const request: RecentEditsDockRequest | null = selectedProject
    ? {
        projectPath: selectedProject.path,
        scope: effectiveScope,
        grouping,
        sessionFilePath: selectedSession?.file_path,
      }
    : null;

  // Keyed on the request identity rather than the object, so the effect reruns
  // exactly when the question being asked changes.
  const requestKey = request ? recentEditsDockRequestKey(request) : null;

  useEffect(() => {
    if (!request) return;
    void loadRecentEditsDock(request);
    // `requestKey` is the whole of `request` in comparable form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, loadRecentEditsDock]);

  const files = useMemo(() => {
    const all = recentEdits?.files ?? [];
    if (!recentEditsMissingOnly) return all;
    // `exists_on_disk` is optional; absent means unknown, so only an explicit
    // `false` counts as missing.
    return all.filter((edit) => edit.exists_on_disk === false);
  }, [recentEdits?.files, recentEditsMissingOnly]);

  const handleLoadMore = () => {
    if (request && recentEdits?.hasMore && !isLoadingMore) {
      void loadMoreRecentEditsDock(request);
    }
  };

  // `exists_on_disk` was resolved when the page was fetched, so a row the user
  // has just restored still reports itself missing: it stays red, stays inside
  // the Missing Only filter, and offers Restore again once the success state
  // times out. Patch that one row rather than refetching the page, which would
  // scroll the list out from under them.
  const handleRestored = (filePath: string) => {
    markRecentEditsDockFileRestored(filePath);
  };

  return (
    <div className="flex h-full flex-col">
      {/*
        Wraps rather than overflows. The scope toggle carries localized labels
        and stops shrinking around 296px, so below that the options trigger was
        pushed past the panel's right edge: at the configured minimum width of
        260 it was not merely clipped but unhittable, leaving grouping and
        density unreachable for anyone who dragged the panel that narrow.
        Wrapping is used instead of a larger minimum width because the labels
        differ per locale, and a width tuned to English would not hold in ko,
        ja, zh-CN or zh-TW.
      */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
        <RecentEditsScopeToggle
          value={effectiveScope}
          onChange={setRecentEditsScope}
          disabled={!canScopeToSession}
        />
        <div className="ml-auto flex items-center gap-1">
          <RecentEditsDensityToggle
            value={density}
            onChange={(next) => setRecentEditsDensity(recentEditsMode, next)}
          />
          <RecentEditsOptionsMenu
            grouping={grouping}
            onGroupingChange={(next) =>
              setRecentEditsGrouping(effectiveScope, next)
            }
            missingOnly={recentEditsMissingOnly}
            onMissingOnlyChange={setRecentEditsMissingOnly}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="px-3 py-6 text-center text-sm text-destructive">
            {error}
          </p>
        ) : isLoading && files.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            {files.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                <FileEdit className="h-6 w-6 opacity-40" aria-hidden="true" />
                <p className="px-4 text-center text-px11">
                  {recentEditsMissingOnly
                    ? t("recentEdits.noMissingFiles", "No missing files")
                    : t("recentEdits.noEdits")}
                </p>
              </div>
            )}
            {files.map((edit, index) =>
              density === "compact" ? (
                <FileEditRowCompact
                  key={`${edit.file_path}-${index}`}
                  edit={edit}
                  isDarkMode={isDarkMode}
                  projectCwd={recentEdits?.projectCwd}
                  grouping={grouping}
                  onJumpToMessage={navigateToMessage}
                  onRestored={handleRestored}
                />
              ) : (
                <div key={`${edit.file_path}-${index}`} className="p-2">
                  {/*
                    `dense` here and nowhere else: this is the only place a card
                    renders inside the dock, and the full-page list wants the
                    larger scale it already has.
                  */}
                  <FileEditItem
                    edit={edit}
                    isDarkMode={isDarkMode}
                    dense
                    projectCwd={recentEdits?.projectCwd}
                    onRestored={handleRestored}
                  />
                </div>
              )
            )}

            {recentEdits?.hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="flex w-full items-center justify-center gap-1.5 border-t border-border/50 py-2 text-px11 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                )}
                {t("recentEdits.loadMore", "Load more")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

RecentEditsPanel.displayName = "RecentEditsPanel";
