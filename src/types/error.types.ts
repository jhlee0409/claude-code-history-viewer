/**
 * Error Types
 *
 * Application error handling types.
 */

// ============================================================================
// Error Type Enum
// ============================================================================

export enum AppErrorType {
  CLAUDE_FOLDER_NOT_FOUND = "CLAUDE_FOLDER_NOT_FOUND",
  TAURI_NOT_AVAILABLE = "TAURI_NOT_AVAILABLE",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  INVALID_PATH = "INVALID_PATH",
  UNKNOWN = "UNKNOWN",
}

// ============================================================================
// App Error
// ============================================================================

export interface AppError {
  type: AppErrorType;
  message: string;
}
