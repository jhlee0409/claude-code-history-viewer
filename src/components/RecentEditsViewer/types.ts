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
  /**
   * Compact scale, for the docked panel. Same card, same information, sized to
   * the list it sits in: the leading glyphs and the type scale match
   * `FileEditRowCompact` so switching density changes the amount of detail
   * rather than the visual language.
   */
  dense?: boolean;
  /**
   * Project root to strip from the path line, as the list rows do. Without it
   * the card shows a full absolute path, which at panel width is mostly the
   * part every row has in common.
   */
  projectCwd?: string;
}

export type RestoreStatus = "idle" | "loading" | "success" | "error";

/**
 * Expanded-view mode for a file edit item:
 * whole file, only added lines, only removed lines, or full diff.
 */
export type EditViewMode = "content" | "added" | "removed" | "diff";
