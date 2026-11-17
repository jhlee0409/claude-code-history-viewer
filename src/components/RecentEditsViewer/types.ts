/**
 * RecentEditsViewer Types
 */

import type { RecentFileEdit } from "../../types";

export interface RecentEditsViewerProps {
  /** Prefills the search (the Board's file links). */
  initialSearchQuery?: string;
}

export interface FileEditItemProps {
  edit: RecentFileEdit;
  isDarkMode: boolean;
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
  /**
   * The project these rows came from, and the session they were scoped to.
   * Restore is authorised against that project's recorded edits (#525), so the
   * caller has to name it - and it must be the request that produced the row,
   * not the live selection, which can have moved on.
   */
  restoreScope?: { projectPath: string; sessionFilePath?: string };
}

export type RestoreStatus = "idle" | "loading" | "success" | "error";

/**
 * Expanded-view mode for a file edit item:
 * whole file, only added lines, only removed lines, or full diff.
 */
export type EditViewMode = "content" | "added" | "removed" | "diff";
