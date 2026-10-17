/**
 * The Edits screen (plan T9b): the one recent-edits surface, opened from the
 * toolbar's Edits tab (on phones from the analytics nav row, Overview ·
 * Tokens · Edits), the same screen on every width.
 *
 * It took over everything the docked panel beside the transcript had: the
 * project/session scope, grouping per scope, row density, the missing-on-disk
 * filter, pages keyed by the request they answer, restore authorised against
 * the rows' own request, the restored-row patch and the jump to the message
 * an edit came from. From the page it keeps the counts, the search over the
 * loaded rows (the Board's file links prefill it), "show more" and the
 * footer note.
 *
 * Deliberately not virtualized: a page is 20 rows, and rows change height
 * when expanded, which a fixed-estimate virtualizer handles badly.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, File, FilePen, FolderOpen, LoaderCircle, Search } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "@/components/icon/Icon";
import { useAppStore } from "@/store/useAppStore";
import { useTheme } from "@/contexts/theme";
import { layout } from "@/components/renderers";
import { LoadingState } from "@/components/ui/loading";
import { recentEditsRequestKey } from "@/store/slices/recentEditsSlice";
import { selectRecentEdits, selectRecentEditsRequest } from "@/navigation/screenOwner";
import { getProviderLabel, supportsRecentEdits } from "@/utils/providers";
import type { ClaudeSession, RecentFileEdit } from "@/types";
import type { RecentEditsViewerProps } from "./types";
import { FileEditItem } from "./FileEditItem";
import { FileEditRowCompact } from "./FileEditRowCompact";
import { RecentEditsDensityToggle, RecentEditsScopeToggle } from "./RecentEditsToggles";
import { RecentEditsOptionsMenu } from "./RecentEditsOptionsMenu";

/** The listed session an edit was recorded in, if the sidebar has it. */
function sessionOfEdit(
  edit: RecentFileEdit,
  sessions: readonly ClaudeSession[],
  selected: ClaudeSession | null
): ClaudeSession | undefined {
  const matches = (s: ClaudeSession) =>
    s.session_id === edit.session_id || s.actual_session_id === edit.session_id;
  if (selected && matches(selected)) return selected;
  return sessions.find(matches);
}

export const RecentEditsViewer: React.FC<RecentEditsViewerProps> = ({
  initialSearchQuery = "",
}) => {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);

  // Sync when the prefill changes (a file link on the Board).
  useEffect(() => {
    setSearchQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  const selectedProject = useAppStore((s) => s.selectedProject);
  const selectedSession = useAppStore((s) => s.selectedSession);
  const sessions = useAppStore((s) => s.sessions);
  const navigate = useAppStore((s) => s.navigate);

  const recentEditsScope = useAppStore((s) => s.recentEditsScope);
  const recentEditsMissingOnly = useAppStore((s) => s.recentEditsMissingOnly);
  const density = useAppStore((s) => s.recentEditsDensity);
  const setRecentEditsScope = useAppStore((s) => s.setRecentEditsScope);
  const setRecentEditsDensity = useAppStore((s) => s.setRecentEditsDensity);
  const setRecentEditsGrouping = useAppStore((s) => s.setRecentEditsGrouping);
  const setRecentEditsMissingOnly = useAppStore((s) => s.setRecentEditsMissingOnly);
  const loadRecentEditsList = useAppStore((s) => s.loadRecentEditsList);
  const loadMoreRecentEditsList = useAppStore((s) => s.loadMoreRecentEditsList);
  const markRecentEditRestored = useAppStore((s) => s.markRecentEditRestored);
  const isLoadingMore = useAppStore((s) => s.isLoadingMoreRecentEdits);

  // With no session selected, session scope has nothing to point at.
  const canScopeToSession = Boolean(selectedSession);
  const effectiveScope = canScopeToSession ? recentEditsScope : "project";
  // The grouping of the scope actually shown, not of the stored one.
  const grouping = useAppStore((s) =>
    effectiveScope === "session" ? s.recentEditsGroupingSession : s.recentEditsGroupingProject
  );

  const request = useAppStore(useShallow(selectRecentEditsRequest));
  // Keyed on the request identity rather than the object, so the effect
  // reruns exactly when the question being asked changes.
  const requestKey = request ? recentEditsRequestKey(request) : null;
  // Only the rows (and the failure) answering this request: the slot may
  // still hold another project's, scope's or tab's answer
  // (`navigation/screenOwner.ts`).
  const { result, isLoading, error } = useAppStore(
    useShallow((s) => selectRecentEdits(s, requestKey))
  );

  useEffect(() => {
    if (!request) return;
    // Shares a load the navigation already started for the same request.
    void loadRecentEditsList(request);
    // `requestKey` is the whole of `request` in comparable form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, loadRecentEditsList]);

  // Taken from the request the rows on screen answer, not from the live
  // selection: restore is authorised against the project (and session) that
  // recorded the edit (#525), and the two differ while a new request loads.
  const answered = result?.request;
  const restoreScope = answered
    ? {
        projectPath: answered.projectPath,
        sessionFilePath: answered.scope === "session" ? answered.sessionFilePath : undefined,
      }
    : undefined;

  const files = useMemo(() => {
    let rows = result?.files ?? [];
    // `exists_on_disk` is optional; absent means unknown, so only an explicit
    // `false` counts as missing.
    if (recentEditsMissingOnly) rows = rows.filter((edit) => edit.exists_on_disk === false);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rows;
    // Client-side, over the rows loaded so far.
    return rows.filter(
      (edit) =>
        edit.file_path.toLowerCase().includes(query) ||
        edit.content_after_change.toLowerCase().includes(query)
    );
  }, [result?.files, recentEditsMissingOnly, searchQuery]);

  const handleLoadMore = useCallback(() => {
    if (request && result?.hasMore && !isLoadingMore) {
      void loadMoreRecentEditsList(request);
    }
  }, [request, result?.hasMore, isLoadingMore, loadMoreRecentEditsList]);

  /** Open the edit's message in its conversation, when its session is listed. */
  const jumpFor = (edit: RecentFileEdit) => {
    const session = sessionOfEdit(edit, sessions, selectedSession);
    if (!session) return undefined;
    return (messageUuid: string) => {
      navigate({ view: "conversation", session, messageId: messageUuid }).catch(
        (jumpError: unknown) => console.error("Failed to open the edit's message:", jumpError)
      );
    };
  };

  if (!selectedProject) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Icon icon={FolderOpen} size={24} className="opacity-40" aria-hidden="true" />
        <p className={layout.bodyText}>{t("recentEdits.noProjectSelected")}</p>
      </div>
    );
  }

  // Before any rows are consulted: they may belong to the previously selected
  // project, and nothing was fetched for this one (#643).
  if (!supportsRecentEdits(selectedProject.provider)) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Icon icon={File} size={24} className="mb-4 text-muted-foreground/50" />
        <p className={`${layout.bodyText} text-muted-foreground`}>
          {t("recentEdits.unavailableForProvider", {
            provider: getProviderLabel((key, fallback) => t(key, fallback), selectedProject.provider),
          })}
        </p>
      </div>
    );
  }

  const loaded = result?.files.length ?? 0;
  // What a row is: a file (latest state) or one edit event.
  const total = result ? (grouping === "edit" ? result.totalEditsCount : result.uniqueFilesCount) : 0;
  const remaining = Math.max(0, total - loaded);
  const isSearching = searchQuery.trim() !== "";
  // Server pages, not the client-side filters: the missing-only filter runs
  // over the loaded rows only, so a file missing on a later page is reachable
  // only through here - even while no loaded row matches. Search keeps it
  // hidden, as the page always did: it narrows what is loaded.
  const showMore = Boolean(result?.hasMore) && !isSearching;
  const showMoreButton = showMore && result ? (
    <button
      type="button"
      onClick={handleLoadMore}
      disabled={isLoadingMore}
      aria-label={t("recentEdits.showMore", { count: Math.min(result.limit || 20, remaining) })}
      className="w-full py-4 rounded-xl text-list font-medium bg-muted/30 hover:bg-muted/50 border border-border/50 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isLoadingMore ? (
        <>
          <LoaderCircle className="w-4 h-4 animate-spin" />
          {t("common.loading")}
        </>
      ) : (
        <>
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
          {t("recentEdits.showMore", { count: Math.min(result.limit || 20, remaining) })}
          <span className="text-muted-foreground/70">
            ({remaining} {t("analytics.remaining")})
          </span>
        </>
      )}
    </button>
  ) : null;

  return (
    <div className="h-full flex flex-col p-3 md:p-6">
      {/*
        The screen's title is the shell's content header; this header holds
        what the list adds: its counts, its controls and the search.
      */}
      <div className="mb-4 md:mb-6 space-y-3">
        {result && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`${layout.smallText} text-muted-foreground truncate min-w-0`}>
              {t("recentEdits.stats", {
                files: result.uniqueFilesCount,
                edits: result.totalEditsCount,
              })}
            </p>
            <span className="text-caption text-muted-foreground font-mono shrink-0">
              {loaded} / {total}
            </span>
          </div>
        )}

        {/*
          Wraps rather than overflows: the scope toggle carries localized
          labels, and at phone width (or in ko/ja/zh) the controls do not fit
          one line beside each other.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <RecentEditsScopeToggle
            value={effectiveScope}
            onChange={setRecentEditsScope}
            sessionDisabled={!canScopeToSession}
          />
          <div className="ml-auto flex items-center gap-1">
            <RecentEditsDensityToggle value={density} onChange={setRecentEditsDensity} />
            <RecentEditsOptionsMenu
              grouping={grouping}
              onGroupingChange={(next) => setRecentEditsGrouping(effectiveScope, next)}
              missingOnly={recentEditsMissingOnly}
              onMissingOnlyChange={setRecentEditsMissingOnly}
            />
          </div>
        </div>

        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
            <span title={t("common.search")}>
              <Search className="w-4 h-4 text-muted-foreground" />
            </span>
          </div>
          <input
            type="text"
            placeholder={t("recentEdits.searchPlaceholder")}
            aria-label={t("recentEdits.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-14 pr-4 py-3 rounded-xl border-2 ${layout.bodyText} border-border bg-card text-foreground focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all duration-300`}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto space-y-3">
        {error || (isLoading && loaded === 0) || !result ? (
          <LoadingState
            isLoading={!error}
            error={error}
            onRetry={request ? () => void loadRecentEditsList(request, { force: true }) : undefined}
            retryLabel={t("common.retry")}
            loadingMessage={t("recentEdits.loading")}
            spinnerSize="lg"
            withSparkle={true}
          />
        ) : result.files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Icon icon={File} size={24} className="mb-4 text-muted-foreground/50" />
            <p className="text-title mb-2 text-muted-foreground">{t("recentEdits.noEdits")}</p>
            <p className={`${layout.bodyText} text-muted-foreground`}>
              {t("recentEdits.noEditsDescription")}
            </p>
          </div>
        ) : files.length === 0 ? (
          <>
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
                <Icon
                  icon={isSearching ? Search : FilePen}
                  size={24}
                  className="text-muted-foreground/40"
                />
              </div>
              <p className={`${layout.bodyText} text-muted-foreground text-center`}>
                {isSearching
                  ? t("recentEdits.noSearchResults")
                  : showMore
                    ? // Only the loaded rows were checked: the rest may hold missing files.
                      t("recentEdits.noMissingFilesLoaded", { loaded, total })
                    : t("recentEdits.noMissingFiles")}
              </p>
            </div>
            {showMoreButton}
          </>
        ) : (
          <>
            {files.map((edit, index) =>
              density === "compact" ? (
                <FileEditRowCompact
                  key={`${edit.file_path}-${index}`}
                  edit={edit}
                  isDarkMode={isDarkMode}
                  projectCwd={result.projectCwd}
                  grouping={grouping}
                  onJumpToMessage={jumpFor(edit)}
                  onRestored={markRecentEditRestored}
                  restoreScope={restoreScope}
                />
              ) : (
                <FileEditItem
                  key={`${edit.file_path}-${index}`}
                  edit={edit}
                  isDarkMode={isDarkMode}
                  onRestored={markRecentEditRestored}
                  restoreScope={restoreScope}
                />
              )
            )}

            {showMoreButton}
          </>
        )}
      </div>

      {grouping === "file" && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <div className={`flex items-center gap-2 ${layout.smallText} text-muted-foreground`}>
            <div className="w-1 h-1 rounded-full bg-accent/50" />
            {t("recentEdits.footerInfo")}
          </div>
        </div>
      )}
    </div>
  );
};

RecentEditsViewer.displayName = "RecentEditsViewer";
