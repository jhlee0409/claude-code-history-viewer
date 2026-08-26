/**
 * Edit Types
 *
 * File edit tracking for recent changes and recovery.
 */

// ============================================================================
// Recent File Edit
// ============================================================================

export interface RecentFileEdit {
  file_path: string;
  timestamp: string;
  session_id: string;
  operation_type: "edit" | "write";
  content_after_change: string;
  original_content?: string;
  lines_added: number;
  lines_removed: number;
  cwd?: string;
  /**
   * UUID of the message this edit came from, used by the jump-to-message
   * arrow. Optional: provider paths that carry no message identity leave it
   * unset, and older cached payloads predate the field.
   */
  message_uuid?: string;
  /**
   * Whether the file is still present on disk. Optional for the same reason:
   * the backend only started reporting it alongside the panel work, so a
   * missing value means "unknown", not "deleted".
   */
  exists_on_disk?: boolean;
}

// ============================================================================
// Recent Edits Result
// ============================================================================

export interface RecentEditsResult {
  files: RecentFileEdit[];
  total_edits_count: number;
  unique_files_count: number;
  project_cwd?: string;
  /**
   * Cache identity: the `project.path` this result was fetched for. Camel-cased
   * because the backend never sends it; the snake_case fields above mirror the
   * payload.
   *
   * Do not cache-match on `project_cwd` instead. It is the most frequent `cwd`
   * observed in the session logs, so it never equals `project.path`, and it is
   * not reliably equal to `project.actual_path` either: they diverge for moved
   * projects, for drive-letter case differences on Windows, and when sessions
   * ran in a subdirectory of the project. It is also absent for providers with
   * virtual paths.
   */
  requestedProjectPath?: string;
}

/**
 * Paginated response for recent edits
 */
export interface PaginatedRecentEdits {
  files: RecentFileEdit[];
  total_edits_count: number;
  unique_files_count: number;
  project_cwd?: string;
  offset: number;
  limit: number;
  has_more: boolean;
}
