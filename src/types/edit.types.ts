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
