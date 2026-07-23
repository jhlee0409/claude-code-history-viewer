/**
 * RecentEditsViewer Types
 */

import type { RecentEditsResult, RecentFileEdit } from "../../types";
import type { RecentEditsPagination } from "../../types/analytics";

export interface RecentEditsViewerProps {
  recentEdits: RecentEditsResult | null;
  pagination?: RecentEditsPagination;
  onLoadMore?: () => void;
  isLoading?: boolean;
  error?: string | null;
  initialSearchQuery?: string;
}

export interface FileEditItemProps {
  edit: RecentFileEdit;
  isDarkMode: boolean;
}

export type RestoreStatus = "idle" | "loading" | "success" | "error";

/**
 * Expanded-view mode for a file edit item:
 * whole file, only added lines, only removed lines, or full diff.
 */
export type EditViewMode = "content" | "added" | "removed" | "diff";
