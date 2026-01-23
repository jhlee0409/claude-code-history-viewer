/**
 * RecentEditsViewer Component
 *
 * Displays a list of recent file edits with search and filtering.
 */

"use client";

import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileEdit, Search, File } from "lucide-react";
import { useTheme } from "@/contexts/theme";
import { layout } from "@/components/renderers";
import { LoadingState } from "@/components/ui/loading";
import type { RecentEditsViewerProps } from "./types";
import { FileEditItem } from "./FileEditItem";

export const RecentEditsViewer: React.FC<RecentEditsViewerProps> = ({
  recentEdits,
  isLoading = false,
  error = null,
}) => {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter files by search query
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

  // Calculate stats based on filtered results
  const stats = useMemo(() => {
    const files = filteredFiles;
    const uniqueFilePaths = new Set(files.map((f) => f.file_path));
    return {
      uniqueFilesCount: uniqueFilePaths.size,
      totalEditsCount: files.length,
    };
  }, [filteredFiles]);

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
          <div
            className={`flex items-center gap-2 ${layout.bodyText} text-accent bg-accent/10 px-3 py-1.5 rounded-full`}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-medium">{stats.totalEditsCount} edits</span>
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
          filteredFiles.map((edit, index) => (
            <FileEditItem key={`${edit.file_path}-${index}`} edit={edit} isDarkMode={isDarkMode} />
          ))
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
