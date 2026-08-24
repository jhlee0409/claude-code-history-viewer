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
  /**
   * Called with the path after a successful restore, so the list can clear the
   * missing flag on that row.
   *
   * `exists_on_disk` was resolved when the page was fetched, so a file that has
   * just been written back still reports itself absent: it stays red and stays
   * inside the Missing Only filter, which then hides the very file the user
   * just recovered. The compact row has always had this; the card did not, so
   * the same restore behaved differently depending on the density.
   */
  onRestored?: (filePath: string) => void;
}

export type RestoreStatus = "idle" | "loading" | "success" | "error";

/**
 * Expanded-view mode for a file edit item:
 * whole file, only added lines, only removed lines, or full diff.
 */
export type EditViewMode = "content" | "added" | "removed" | "diff";
