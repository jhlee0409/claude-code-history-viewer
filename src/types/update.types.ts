/**
 * Update Types
 *
 * Application update checking and metadata.
 */

// ============================================================================
// Update Enums
// ============================================================================

export type UpdatePriority = "critical" | "recommended" | "optional";
export type UpdateType = "hotfix" | "feature" | "patch" | "major";

// ============================================================================
// Update Message
// ============================================================================

export interface UpdateMessage {
  title: string;
  description: string;
  features: string[];
}

// ============================================================================
// Update Metadata
// ============================================================================

export interface UpdateMetadata {
  priority: UpdatePriority;
  type: UpdateType;
  force_update: boolean;
  minimum_version?: string;
  deadline?: string;
  message: UpdateMessage;
}

// ============================================================================
// Update Info
// ============================================================================

export interface UpdateInfo {
  has_update: boolean;
  latest_version?: string;
  current_version: string;
  download_url?: string;
  release_url?: string;
  metadata?: UpdateMetadata;
  is_forced: boolean;
  days_until_deadline?: number;
}
