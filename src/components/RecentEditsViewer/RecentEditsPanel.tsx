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

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FileEdit, Loader2 } from "lucide-react";
import { useTheme } from "@/contexts/theme";
import { useAppStore } from "@/store/useAppStore";
import {
  selectRecentEditsDensity,
  selectRecentEditsGrouping,
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

  const analytics = useAppStore((s) => s.analytics);
  const selectedSession = useAppStore((s) => s.selectedSession);
  const selectedProject = useAppStore((s) => s.selectedProject);
  const loadMoreRecentEdits = useAppStore((s) => s.loadMoreRecentEdits);
  const navigateToMessage = useAppStore((s) => s.navigateToMessage);

  const recentEditsMode = useAppStore((s) => s.recentEditsMode);
  const recentEditsScope = useAppStore((s) => s.recentEditsScope);
  const recentEditsMissingOnly = useAppStore((s) => s.recentEditsMissingOnly);
  const setRecentEditsMode = useAppStore((s) => s.setRecentEditsMode);
  const setRecentEditsScope = useAppStore((s) => s.setRecentEditsScope);
  const setRecentEditsDensity = useAppStore((s) => s.setRecentEditsDensity);
  const setRecentEditsGrouping = useAppStore((s) => s.setRecentEditsGrouping);
  const setRecentEditsMissingOnly = useAppStore(
    (s) => s.setRecentEditsMissingOnly
  );
  const setRecentEditsDockOpen = useAppStore((s) => s.setRecentEditsDockOpen);

  const density = useAppStore(selectRecentEditsDensity);
  const grouping = useAppStore(selectRecentEditsGrouping);

  const recentEdits = analytics.recentEdits;
  const pagination = analytics.recentEditsPagination;
  const isLoading = analytics.isLoadingRecentEdits;
  const error = analytics.recentEditsError;

  // With no session selected, session scope has nothing to point at.
  const canScopeToSession = Boolean(selectedSession);

  const files = useMemo(() => {
    const all = recentEdits?.files ?? [];
    if (!recentEditsMissingOnly) return all;
    // `exists_on_disk` is optional; absent means unknown, so only an explicit
    // `false` counts as missing.
    return all.filter((edit) => edit.exists_on_disk === false);
  }, [recentEdits?.files, recentEditsMissingOnly]);

  const handleUndock = () => {
    setRecentEditsMode("page");
    setRecentEditsDockOpen(false);
  };

  const handleLoadMore = () => {
    if (
      selectedProject &&
      pagination?.hasMore &&
      !pagination?.isLoadingMore
    ) {
      void loadMoreRecentEdits(selectedProject.path);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
        <RecentEditsScopeToggle
          value={canScopeToSession ? recentEditsScope : "project"}
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
              setRecentEditsGrouping(
                canScopeToSession ? recentEditsScope : "project",
                next
              )
            }
            missingOnly={recentEditsMissingOnly}
            onMissingOnlyChange={setRecentEditsMissingOnly}
            onUndock={handleUndock}
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
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <FileEdit className="h-6 w-6 opacity-40" aria-hidden="true" />
            <p className="px-4 text-center text-px11">
              {recentEditsMissingOnly
                ? t("recentEdits.noMissingFiles", "No missing files")
                : t("recentEdits.noEdits")}
            </p>
          </div>
        ) : (
          <>
            {files.map((edit, index) =>
              density === "compact" ? (
                <FileEditRowCompact
                  key={`${edit.file_path}-${index}`}
                  edit={edit}
                  isDarkMode={isDarkMode}
                  projectCwd={recentEdits?.project_cwd}
                  grouping={grouping}
                  onJumpToMessage={navigateToMessage}
                />
              ) : (
                <div key={`${edit.file_path}-${index}`} className="p-2">
                  <FileEditItem edit={edit} isDarkMode={isDarkMode} />
                </div>
              )
            )}

            {pagination?.hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={pagination?.isLoadingMore}
                className="flex w-full items-center justify-center gap-1.5 border-t border-border/50 py-2 text-px11 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
              >
                {pagination?.isLoadingMore ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ChevronDown className="h-3 w-3" aria-hidden="true" />
                )}
                {t("common.loadMore", "Load more")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

RecentEditsPanel.displayName = "RecentEditsPanel";
