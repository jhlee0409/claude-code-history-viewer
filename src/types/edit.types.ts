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
