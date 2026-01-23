/**
 * RecentEditsViewer Types
 */

import type { RecentEditsResult, RecentFileEdit } from "../../types";

export interface RecentEditsViewerProps {
  recentEdits: RecentEditsResult | null;
  isLoading?: boolean;
  error?: string | null;
}

export interface FileEditItemProps {
  edit: RecentFileEdit;
  isDarkMode: boolean;
}

export type RestoreStatus = "idle" | "loading" | "success" | "error";
