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
}

export interface FileEditItemProps {
  edit: RecentFileEdit;
  isDarkMode: boolean;
}

export type RestoreStatus = "idle" | "loading" | "success" | "error";
