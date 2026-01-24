/**
 * RecentEditsViewer Component
 *
 * Displays a list of recent file edits with search and filtering.
 * Now supports real backend pagination.
 */

"use client";

import React, { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FileEdit, Search, File, ChevronDown, Loader2 } from "lucide-react";
import { useTheme } from "@/contexts/theme";
import { layout } from "@/components/renderers";
import { LoadingState } from "@/components/ui/loading";
import type { RecentEditsViewerProps } from "./types";
import { FileEditItem } from "./FileEditItem";

export const RecentEditsViewer: React.FC<RecentEditsViewerProps> = ({
  recentEdits,
  pagination,
  onLoadMore,
  isLoading = false,
  error = null,
}) => {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");

  // Handle "Show More" click - calls backend via onLoadMore
  const handleShowMore = useCallback(() => {
    if (onLoadMore && pagination?.hasMore && !pagination?.isLoadingMore) {
      onLoadMore();
    }
  }, [onLoadMore, pagination?.hasMore, pagination?.isLoadingMore]);

  // Filter files by search query (client-side filtering on loaded data)
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

  // Calculate stats based on pagination or filtered results
  const stats = useMemo(() => {
    return {
      uniqueFilesCount: pagination?.uniqueFilesCount ?? recentEdits?.unique_files_count ?? 0,
      totalEditsCount: pagination?.totalEditsCount ?? recentEdits?.total_edits_count ?? 0,
    };
  }, [pagination, recentEdits]);

  // Use filteredFiles directly - pagination is handled by backend
  const displayedFiles = filteredFiles;

  // Pagination state from props
  const hasMoreFiles = searchQuery.trim() ? false : (pagination?.hasMore ?? false);
  const isLoadingMore = pagination?.isLoadingMore ?? false;
  const totalUniqueFiles = pagination?.uniqueFilesCount ?? recentEdits?.unique_files_count ?? 0;
  const remainingCount = totalUniqueFiles - (recentEdits?.files?.length ?? 0);

  // Loading/Error/Empty states
  if (isLoading || error || !recentEdits || recentEdits.files.length === 0) {
    return (
      <LoadingState
        isLoading={isLoading}
        error={error}
        isEmpty={!recentEdits || recentEdits.files.length === 0}
        loadingMessage={t("recentEdits.loading")}
        spinnerSize="lg"
        withSparkle={true}
        emptyComponent={
          <div className="flex flex-col items-center justify-center py-12">
            <File className="w-12 h-12 mb-4 text-muted-foreground/50" />
            <p className="text-lg mb-2 text-muted-foreground">{t("recentEdits.noEdits")}</p>
            <p className={`${layout.bodyText} text-muted-foreground`}>
              {t("recentEdits.noEditsDescription")}
            </p>
          </div>
        }
      />
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
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground font-mono">
              {recentEdits?.files?.length ?? 0} / {totalUniqueFiles}
            </span>
            <div
              className={`flex items-center gap-2 ${layout.bodyText} text-accent bg-accent/10 px-3 py-1.5 rounded-full`}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="font-medium">{stats.totalEditsCount} edits</span>
            </div>
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
          <>
            {displayedFiles.map((edit, index) => (
              <FileEditItem key={`${edit.file_path}-${index}`} edit={edit} isDarkMode={isDarkMode} />
            ))}

            {/* Show More Button */}
            {hasMoreFiles && (
              <button
                type="button"
                onClick={handleShowMore}
                disabled={isLoadingMore}
                aria-label={t("recentEdits.showMore", { count: Math.min(pagination?.limit ?? 20, remainingCount) })}
                className="w-full py-4 rounded-xl text-[13px] font-medium bg-muted/30 hover:bg-muted/50 border border-border/50 hover:border-border text-muted-foreground hover:text-foreground transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("common.loading")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    {t("recentEdits.showMore", { count: Math.min(pagination?.limit ?? 20, remainingCount) })}
                    <span className="text-muted-foreground/70">
                      ({remainingCount} {t("analytics.remaining")})
                    </span>
                  </>
                )}
              </button>
            )}
          </>
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

RecentEditsViewer.displayName = "RecentEditsViewer";
